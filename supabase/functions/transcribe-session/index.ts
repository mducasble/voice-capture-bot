import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB

interface IndividualRecording {
  id: string;
  discord_username: string | null;
  discord_user_id: string;
  file_url: string | null;
  mp3_file_url: string | null;
  language: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface ElevenLabsWord {
  text: string;
  start: number;
  end: number;
  speaker?: string;
}

interface SpeakerSegment {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const session_id: string | undefined = body?.session_id;
    const mixed_recording_id: string | undefined = body?.mixed_recording_id;

    if (!session_id && !mixed_recording_id) {
      return json({ error: "Missing session_id or mixed_recording_id" }, 400);
    }

    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVENLABS_API_KEY) {
      return json({ error: "ElevenLabs API key not configured" }, 500);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    let targetSessionId = session_id;

    // If mixed_recording_id provided, get session_id from it
    if (!targetSessionId && mixed_recording_id) {
      const { data: mixedRec } = await supabase
        .from('voice_recordings')
        .select('session_id')
        .eq('id', mixed_recording_id)
        .single();

      if (!mixedRec?.session_id) {
        return json({ error: "No session_id found for this recording" }, 404);
      }
      targetSessionId = mixedRec.session_id;
    }

    console.log(`Aggregating session transcriptions for session: ${targetSessionId}`);

    // Fetch all individual recordings for this session
    const { data: individualRecordings, error: fetchError } = await supabase
      .from('voice_recordings')
      .select('id, discord_username, discord_user_id, file_url, mp3_file_url, language, metadata, created_at')
      .eq('session_id', targetSessionId)
      .eq('recording_type', 'individual')
      .order('discord_user_id');

    if (fetchError) {
      console.error('Failed to fetch individual recordings:', fetchError);
      return json({ error: "Failed to fetch recordings" }, 500);
    }

    if (!individualRecordings || individualRecordings.length === 0) {
      return json({ 
        success: false, 
        error: "no_individual_tracks",
        message: "Não foram encontradas faixas individuais para esta sessão." 
      }, 200);
    }

    console.log(`Found ${individualRecordings.length} individual recordings`);

    // Transcribe each individual track and collect word-level timestamps
    const allSegments: SpeakerSegment[] = [];
    const speakerMeta: { username: string; user_id: string; has_transcription: boolean }[] = [];

    for (const rec of individualRecordings as IndividualRecording[]) {
      const speaker = rec.discord_username || `User_${rec.discord_user_id.slice(-4)}`;
      const audioUrl = rec.mp3_file_url || rec.file_url;
      
      if (!audioUrl) {
        console.log(`No audio URL for recording ${rec.id}, skipping`);
        speakerMeta.push({ username: speaker, user_id: rec.discord_user_id, has_transcription: false });
        continue;
      }

      // Check if we already have cached ElevenLabs words in metadata
      const cachedWords = (rec.metadata as Record<string, unknown> | null)?.elevenlabs_words as ElevenLabsWord[] | undefined;
      
      if (cachedWords && cachedWords.length > 0) {
        console.log(`Using cached transcription for ${speaker} (${cachedWords.length} words)`);
        const segments = wordsToSegments(cachedWords, speaker);
        allSegments.push(...segments);
        speakerMeta.push({ username: speaker, user_id: rec.discord_user_id, has_transcription: true });
        continue;
      }

      console.log(`Transcribing track for ${speaker}...`);

      try {
        const words = await transcribeWithElevenLabs(audioUrl, ELEVENLABS_API_KEY, rec.language);
        
        if (words.length > 0) {
          // Cache the words in metadata for future use
          await supabase
            .from('voice_recordings')
            .update({
              metadata: {
                ...(rec.metadata || {}),
                elevenlabs_words: words,
                elevenlabs_transcribed_at: new Date().toISOString()
              }
            })
            .eq('id', rec.id);

          const segments = wordsToSegments(words, speaker);
          allSegments.push(...segments);
          speakerMeta.push({ username: speaker, user_id: rec.discord_user_id, has_transcription: true });
        } else {
          speakerMeta.push({ username: speaker, user_id: rec.discord_user_id, has_transcription: false });
        }
      } catch (err) {
        console.error(`Failed to transcribe track for ${speaker}:`, err);
        speakerMeta.push({ username: speaker, user_id: rec.discord_user_id, has_transcription: false });
      }
    }

    if (allSegments.length === 0) {
      return json({
        success: false,
        error: "no_transcriptions",
        message: "Nenhuma faixa individual foi transcrita com sucesso."
      }, 200);
    }

    // Sort all segments by start time to create chronological timeline
    allSegments.sort((a, b) => a.start - b.start);

    // Merge adjacent segments from same speaker
    const mergedSegments = mergeAdjacentSegments(allSegments);

    // Format as timeline conversation
    const timelineTranscription = mergedSegments
      .map(seg => `[${seg.speaker}]: ${seg.text}`)
      .join('\n\n');

    // Update mixed recording with timeline transcription
    if (mixed_recording_id) {
      const { error: updateError } = await supabase
        .from('voice_recordings')
        .update({
          transcription_elevenlabs: timelineTranscription,
          transcription_elevenlabs_status: 'completed',
          metadata: {
            speaker_segments: mergedSegments,
            speakers: speakerMeta,
            aggregated_at: new Date().toISOString()
          }
        })
        .eq('id', mixed_recording_id);

      if (updateError) {
        console.error('Failed to update mixed recording:', updateError);
      } else {
        console.log(`Saved timeline transcription to mixed recording ${mixed_recording_id}`);
      }
    }

    return json({
      success: true,
      session_id: targetSessionId,
      speakers: speakerMeta,
      transcription: timelineTranscription,
      segment_count: mergedSegments.length,
      stats: {
        total_tracks: individualRecordings.length,
        transcribed: speakerMeta.filter(s => s.has_transcription).length
      }
    });

  } catch (error) {
    console.error('Error:', error);
    return json({ error: "Failed to aggregate transcriptions", details: String(error) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Group words into sentence-like segments (by punctuation or pause gaps)
function wordsToSegments(words: ElevenLabsWord[], speaker: string): SpeakerSegment[] {
  if (words.length === 0) return [];

  const segments: SpeakerSegment[] = [];
  let currentSegment: { words: string[]; start: number; end: number } | null = null;
  const PAUSE_THRESHOLD = 1.5; // seconds - gap that indicates new segment

  for (const word of words) {
    const text = word.text.trim();
    if (!text) continue;

    if (!currentSegment) {
      currentSegment = { words: [text], start: word.start, end: word.end };
      continue;
    }

    // Check for pause gap
    const gap = word.start - currentSegment.end;
    const endsWithPunctuation = /[.!?]$/.test(currentSegment.words[currentSegment.words.length - 1]);

    if (gap > PAUSE_THRESHOLD || endsWithPunctuation) {
      // Finalize current segment
      segments.push({
        speaker,
        text: currentSegment.words.join(' '),
        start: currentSegment.start,
        end: currentSegment.end
      });
      currentSegment = { words: [text], start: word.start, end: word.end };
    } else {
      currentSegment.words.push(text);
      currentSegment.end = word.end;
    }
  }

  // Push last segment
  if (currentSegment && currentSegment.words.length > 0) {
    segments.push({
      speaker,
      text: currentSegment.words.join(' '),
      start: currentSegment.start,
      end: currentSegment.end
    });
  }

  return segments;
}

// Merge adjacent segments from the same speaker
function mergeAdjacentSegments(segments: SpeakerSegment[]): SpeakerSegment[] {
  if (segments.length === 0) return [];

  const merged: SpeakerSegment[] = [];
  let current = { ...segments[0] };

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    
    // If same speaker and close in time, merge
    if (seg.speaker === current.speaker && (seg.start - current.end) < 2.0) {
      current.text += ' ' + seg.text;
      current.end = seg.end;
    } else {
      merged.push(current);
      current = { ...seg };
    }
  }

  merged.push(current);
  return merged;
}

async function transcribeWithElevenLabs(
  audioUrl: string, 
  apiKey: string, 
  language: string | null
): Promise<ElevenLabsWord[]> {
  // Download audio
  const resp = await fetch(audioUrl);
  if (!resp.ok) throw new Error(`Failed to download audio: ${resp.status}`);
  
  const blob = await resp.blob();
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large: ${(blob.size / 1024 / 1024).toFixed(1)}MB`);
  }

  // Detect format from URL
  const urlLower = audioUrl.toLowerCase();
  let filename = "audio.wav";
  let mimeType = "audio/wav";
  
  if (urlLower.includes(".mp3")) {
    filename = "audio.mp3";
    mimeType = "audio/mpeg";
  } else if (urlLower.includes(".m4a")) {
    filename = "audio.m4a";
    mimeType = "audio/mp4";
  } else if (urlLower.includes(".ogg")) {
    filename = "audio.ogg";
    mimeType = "audio/ogg";
  }

  const formData = new FormData();
  formData.append("file", new Blob([blob], { type: mimeType }), filename);
  formData.append("model_id", "scribe_v2");
  formData.append("timestamps_granularity", "word"); // Get word-level timestamps

  if (language) {
    const langMap: Record<string, string> = {
      pt: "por", en: "eng", es: "spa", fr: "fra", de: "deu",
      it: "ita", ja: "jpn", ko: "kor", zh: "zho", ru: "rus"
    };
    const langCode = langMap[language.toLowerCase()] || language;
    formData.append("language_code", langCode);
  }

  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("ElevenLabs API error:", response.status, errText);
    throw new Error(`ElevenLabs API error: ${response.status}`);
  }

  const result = await response.json();
  
  // Extract words with timestamps
  return (result.words || []) as ElevenLabsWord[];
}
