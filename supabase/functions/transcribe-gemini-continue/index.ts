import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const CHUNKS_PER_INVOCATION = 5;
const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface GeminiChunkState {
  chunkUrls: { url: string; index: number }[];
  nextIndex: number;
  transcriptions: string[];
  detectedLanguage: string | null;
  lockedAt: string | null;
}

interface TranscriptionSegment {
  start: string;
  end: string;
  speaker: string;
  text: string;
}

const CHUNK_DURATION_SECONDS = 30;

function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { recording_id } = await req.json();

    if (!recording_id) {
      return new Response(
        JSON.stringify({ error: 'Missing recording_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'Transcription service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch current state
    const { data: recording, error: fetchError } = await supabase
      .from('voice_recordings')
      .select('gemini_chunk_state, transcription, language')
      .eq('id', recording_id)
      .single();

    if (fetchError || !recording) {
      console.error('Failed to fetch recording:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Recording not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let state: GeminiChunkState = recording.gemini_chunk_state;

    if (!state || !state.chunkUrls || state.chunkUrls.length === 0) {
      console.log('No chunks to transcribe or already completed');
      return new Response(
        JSON.stringify({ success: true, message: 'No chunks to process' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if already completed
    if (state.nextIndex >= state.chunkUrls.length) {
      console.log('All chunks already processed');
      return new Response(
        JSON.stringify({ success: true, message: 'All chunks already processed' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if locked by another process
    if (state.lockedAt) {
      const lockAge = Date.now() - new Date(state.lockedAt).getTime();
      if (lockAge < LOCK_TIMEOUT_MS) {
        console.log(`Recording is locked (${Math.round(lockAge / 1000)}s old), skipping`);
        return new Response(
          JSON.stringify({ success: false, message: 'Recording is locked' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log(`Lock expired (${Math.round(lockAge / 1000)}s old), taking over`);
    }

    // Acquire lock
    state.lockedAt = new Date().toISOString();
    await supabase.from('voice_recordings')
      .update({
        gemini_chunk_state: state,
        transcription_status: 'processing'
      })
      .eq('id', recording_id);

    // Process chunks
    const startIdx = state.nextIndex;
    const endIdx = Math.min(startIdx + CHUNKS_PER_INVOCATION, state.chunkUrls.length);

    console.log(`Processing Gemini chunks ${startIdx}-${endIdx - 1} of ${state.chunkUrls.length}`);

    for (let i = startIdx; i < endIdx; i++) {
      const chunk = state.chunkUrls[i];
      console.log(`Transcribing chunk ${chunk.index}...`);

      try {
        const transcription = await transcribeChunk(chunk.url, state.detectedLanguage, LOVABLE_API_KEY);

        if (transcription.text) {
          state.transcriptions[i] = transcription.text;
        } else {
          state.transcriptions[i] = '';
        }

        if (!state.detectedLanguage && transcription.language) {
          state.detectedLanguage = transcription.language;
        }

        console.log(`Chunk ${chunk.index} transcribed: ${transcription.text?.length || 0} chars`);
      } catch (chunkError) {
        console.error(`Chunk ${chunk.index} error:`, chunkError);
        state.transcriptions[i] = '';
      }
    }

    state.nextIndex = endIdx;

    // Check if all chunks are done
    if (state.nextIndex >= state.chunkUrls.length) {
      // Combine transcriptions into plain text
      const fullTranscription = state.transcriptions.filter(t => t).join('\n\n');
      
      // Build segments with timestamps based on chunk positions
      const segments: TranscriptionSegment[] = [];
      for (let i = 0; i < state.transcriptions.length; i++) {
        const text = state.transcriptions[i]?.trim();
        if (!text) continue;
        
        const startSeconds = i * CHUNK_DURATION_SECONDS;
        const endSeconds = (i + 1) * CHUNK_DURATION_SECONDS;
        
        segments.push({
          start: formatTimestamp(startSeconds),
          end: formatTimestamp(endSeconds),
          speaker: "speaker A", // Single speaker for individual tracks
          text: text
        });
      }
      
      // Prepare metadata with segments
      const updatedMetadata: Record<string, unknown> = {
        gemini_segments: segments,
        gemini_completed_at: new Date().toISOString()
      };

      // First fetch current metadata to merge
      const { data: currentRec } = await supabase
        .from('voice_recordings')
        .select('metadata')
        .eq('id', recording_id)
        .single();
      
      const mergedMetadata = {
        ...(currentRec?.metadata || {}),
        ...updatedMetadata
      };

      await supabase.from('voice_recordings')
        .update({
          transcription: fullTranscription,
          transcription_status: fullTranscription ? 'completed' : 'failed',
          language: state.detectedLanguage?.toLowerCase() || recording.language,
          gemini_chunk_state: null, // Clear state when done
          metadata: mergedMetadata
        })
        .eq('id', recording_id);

      console.log(`Transcription complete: ${fullTranscription.length} chars, ${segments.length} segments`);

      return new Response(
        JSON.stringify({
          success: true,
          transcription_length: fullTranscription.length,
          chunks_processed: state.chunkUrls.length,
          segments_count: segments.length
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      // Save progress and continue
      state.lockedAt = null; // Release lock before continuation

      // Save intermediate transcription
      const partialTranscription = state.transcriptions.filter(t => t).join('\n\n');

      await supabase.from('voice_recordings')
        .update({
          gemini_chunk_state: state,
          transcription: partialTranscription
        })
        .eq('id', recording_id);

      console.log(`Saved progress at chunk ${state.nextIndex}, scheduling continuation...`);

      // Schedule continuation
      const invokePromise = supabase.functions.invoke('transcribe-gemini-continue', {
        body: { recording_id }
      });

      // @ts-ignore - EdgeRuntime is available in Supabase Edge Functions
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(
          invokePromise.catch((err: unknown) => console.error("Failed to schedule continuation:", err))
        );
      } else {
        await invokePromise.catch((err: unknown) => console.error("Failed to schedule continuation:", err));
      }

      return new Response(
        JSON.stringify({
          success: true,
          chunks_processed: state.nextIndex,
          total_chunks: state.chunkUrls.length,
          continuing: true
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: 'Transcription continuation failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function transcribeChunk(
  audioUrl: string,
  language: string | null,
  apiKey: string
): Promise<{ text: string; language: string | null }> {
  // Download audio
  const audioResp = await fetch(audioUrl);
  if (!audioResp.ok) {
    throw new Error('Failed to download audio');
  }

  const audioBuffer = await audioResp.arrayBuffer();
  const audioBytes = new Uint8Array(
    audioBuffer.byteLength > MAX_AUDIO_BYTES
      ? audioBuffer.slice(0, MAX_AUDIO_BYTES)
      : audioBuffer
  );

  // Detect format from URL
  const isMP3 = audioUrl.toLowerCase().includes('.mp3');
  const audioFormat = isMP3 ? 'mp3' : 'wav';

  const base64Audio = encode(audioBytes.buffer);

  const languageInstruction = language
    ? `The audio is in ${language}. Transcribe it EXACTLY in that language.`
    : 'Automatically detect the language and transcribe EXACTLY in that language.';

  const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'system',
          content: `You are a STRICT audio transcription tool. Your ONLY job is to transcribe the EXACT words spoken in the audio.

CRITICAL RULES:
1. Transcribe ONLY what is actually spoken - word for word
2. Do NOT describe sounds, noises, or what you "hear"
3. Do NOT add commentary or interpretation
4. Do NOT invent or hallucinate content
5. If the audio is silence or unintelligible, return empty transcription
6. If you cannot understand the speech, return empty transcription
7. NEVER generate fake conversations or made-up dialogue

${languageInstruction}

Respond ONLY with this exact JSON format: {"detected_language": "ISO code", "transcription": "exact words spoken or empty string"}`
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Transcribe the EXACT words spoken in this audio. Do not describe or interpret - only transcribe:' },
            { type: 'input_audio', input_audio: { data: base64Audio, format: audioFormat } }
          ]
        }
      ]
    }),
  });

  if (!aiResponse.ok) {
    const errText = await aiResponse.text();
    console.error('AI error:', aiResponse.status, errText);
    throw new Error(`AI error: ${aiResponse.status}`);
  }

  const aiData = await aiResponse.json();
  const rawContent = aiData.choices?.[0]?.message?.content?.trim() || '';

  let transcription = rawContent;
  let detectedLanguage: string | null = null;

  try {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      transcription = parsed.transcription || rawContent;
      detectedLanguage = parsed.detected_language || null;
    }
  } catch {
    // Use raw content as transcription
  }

  return { text: transcription, language: detectedLanguage };
}
