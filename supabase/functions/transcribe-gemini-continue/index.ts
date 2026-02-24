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
const MAX_TRANSCRIPTION_CHARS_PER_CHUNK = 1800;

interface GeminiChunkState {
  chunkUrls: { url: string; index: number }[];
  nextIndex: number;
  transcriptions: string[];
  chunkSegments: TranscriptionSegment[][]; // Segments per chunk for fine-grained timestamps
  detectedLanguage: string | null;
  lockedAt: string | null;
}

interface TranscriptionSegment {
  start: string;
  end: string;
  speaker: string;
  text: string;
}

interface ChunkSegment {
  start_offset: number; // seconds from chunk start
  end_offset: number;
  text: string;
}

interface ChunkResult {
  segments: ChunkSegment[];
  language: string | null;
}

const CHUNK_DURATION_SECONDS = 30;

function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
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

    // Initialize chunkSegments array if not present (backwards compatibility)
    if (!state.chunkSegments) {
      state.chunkSegments = state.chunkUrls.map(() => []);
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
        // NOTE: do NOT force language; let the model transcribe in the original language.
        const result = await transcribeChunkWithSegments(chunk.url, null, LOVABLE_API_KEY);
        const chunkBaseSeconds = chunk.index * CHUNK_DURATION_SECONDS;

        // Convert relative offsets to absolute timestamps
        const absoluteSegments: TranscriptionSegment[] = result.segments.map(seg => ({
          start: formatTimestamp(chunkBaseSeconds + seg.start_offset),
          end: formatTimestamp(chunkBaseSeconds + seg.end_offset),
          speaker: "speaker A",
          text: seg.text
        }));

        // Store plain text for backward compatibility
        const plainText = result.segments.map(s => s.text).join(' ');
        state.transcriptions[i] = plainText;
        state.chunkSegments[i] = absoluteSegments;

        if (!state.detectedLanguage && result.language) {
          state.detectedLanguage = result.language;
        }

        console.log(`Chunk ${chunk.index} transcribed: ${result.segments.length} segments, ${plainText.length} chars`);
      } catch (chunkError) {
        console.error(`Chunk ${chunk.index} error:`, chunkError);
        state.transcriptions[i] = '';
        state.chunkSegments[i] = [];
      }
    }

    state.nextIndex = endIdx;

    // Check if all chunks are done
    if (state.nextIndex >= state.chunkUrls.length) {
      // Combine transcriptions into plain text
      const fullTranscription = state.transcriptions.filter(t => t).join('\n\n');
      
      // Flatten all chunk segments into final segments array
      const segments: TranscriptionSegment[] = state.chunkSegments.flat().filter(s => s.text.trim());
      
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

      // Schedule continuation, but only if the job wasn't cancelled (gemini_chunk_state still exists)
      const { data: latest } = await supabase
        .from("voice_recordings")
        .select("gemini_chunk_state")
        .eq("id", recording_id)
        .single();

      const stillActive = !!latest?.gemini_chunk_state;
      if (stillActive) {
        console.log(`Saved progress at chunk ${state.nextIndex}, scheduling continuation...`);

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
      } else {
        console.log("Gemini job was cancelled; skipping continuation scheduling");
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

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function isLikelyHallucination(text: string): boolean {
  const cleaned = normalizeWhitespace(text);
  if (!cleaned) return false;
  if (cleaned.length > MAX_TRANSCRIPTION_CHARS_PER_CHUNK) return true;

  const lower = cleaned.toLowerCase();
  const badPhrases = [
    "as an ai",
    "i'm sorry",
    "i cannot",
    "i can't",
    "i am unable",
    "i don't have access",
  ];
  if (badPhrases.some((p) => lower.includes(p))) return true;

  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  // Detect extreme repetition (common failure mode when audio is unclear).
  let run = 1;
  for (let i = 1; i < words.length; i++) {
    if (words[i] === words[i - 1]) {
      run++;
      if (run >= 8) return true;
    } else {
      run = 1;
    }
  }

  // If the vocabulary is too small for a long chunk, it's likely a loop/hallucination.
  if (words.length >= 30) {
    const uniqueRatio = new Set(words).size / words.length;
    if (uniqueRatio < 0.25) return true;
  }

  return false;
}

async function transcribeChunkWithSegments(
  audioUrl: string,
  language: string | null,
  apiKey: string
): Promise<ChunkResult> {
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

  const languageInstruction = "Transcribe in the ORIGINAL language. Do NOT translate.";

  const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `You are a STRICT audio transcription tool with TIMESTAMP capability. Your job is to transcribe the EXACT words spoken and provide timestamps for each sentence or phrase.

CRITICAL RULES:
1. Transcribe ONLY what is actually spoken - word for word
2. Do NOT describe sounds, noises, or what you "hear"
3. Do NOT add commentary or interpretation
4. Do NOT invent or hallucinate content
5. If the audio is silence or unintelligible, return empty segments array
6. If you cannot understand the speech, return empty segments array
7. NEVER generate fake conversations or made-up dialogue
8. If you are uncertain about the words, DO NOT guess: return empty segments

TIMESTAMP RULES:
- The audio chunk is up to 30 seconds long
- Provide start_offset and end_offset in SECONDS (0-30) relative to the start of this chunk
- Split the transcription into natural sentences or phrases (typically 3-10 seconds each)
- Estimate timestamps based on when words are spoken in the audio

${languageInstruction}

Respond ONLY with this exact JSON format:
{
  "detected_language": "ISO code",
  "segments": [
    {"start_offset": 0.0, "end_offset": 5.2, "text": "First sentence spoken"},
    {"start_offset": 5.5, "end_offset": 12.0, "text": "Second sentence spoken"}
  ]
}

If no speech is detected, return: {"detected_language": null, "segments": []}`
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Transcribe the EXACT words spoken in this audio with timestamps for each sentence. Do not describe or interpret - only transcribe:' },
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

  // Parse JSON response
  let detectedLanguage: string | null = null;
  try {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('AI returned non-JSON content; dropping chunk transcription');
      return { segments: [], language: null };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    detectedLanguage = typeof parsed?.detected_language === 'string' ? parsed.detected_language : null;
    
    const rawSegments = Array.isArray(parsed?.segments) ? parsed.segments : [];
    
    // Validate and filter segments
    const validSegments: ChunkSegment[] = rawSegments
      .filter((seg: any) => {
        if (typeof seg?.text !== 'string' || !seg.text.trim()) return false;
        if (typeof seg?.start_offset !== 'number' || typeof seg?.end_offset !== 'number') return false;
        if (seg.start_offset < 0 || seg.end_offset > CHUNK_DURATION_SECONDS + 5) return false; // Allow small overflow
        return true;
      })
      .map((seg: any) => ({
        start_offset: Math.max(0, seg.start_offset),
        end_offset: Math.min(CHUNK_DURATION_SECONDS, seg.end_offset),
        text: seg.text.trim()
      }))
      .filter((seg: ChunkSegment) => !isLikelyHallucination(seg.text));

    return { segments: validSegments, language: detectedLanguage };
  } catch (e) {
    console.warn('Failed to parse AI JSON; dropping chunk transcription', e);
    return { segments: [], language: null };
  }
}
