import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB

interface SessionState {
  session_id: string;
  mixed_recording_id?: string;
  pending_track_ids: string[];
  processed_track_ids: string[];
  all_segments: SpeakerSegment[];
  speaker_meta: SpeakerMeta[];
}

interface SpeakerMeta {
  username: string;
  user_id: string;
  has_transcription: boolean;
}

interface IndividualRecording {
  id: string;
  discord_username: string | null;
  discord_user_id: string;
  file_url: string | null;
  mp3_file_url: string | null;
  language: string | null;
  metadata: Record<string, unknown> | null;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const session_id: string | undefined = body?.session_id;
    const mixed_recording_id: string | undefined = body?.mixed_recording_id;
    const state: SessionState | undefined = body?.state;

    if (!session_id && !mixed_recording_id && !state) {
      return json({ error: "Missing session_id, mixed_recording_id, or state" }, 400);
    }

    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVENLABS_API_KEY) {
      return json({ error: "ElevenLabs API key not configured" }, 500);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // If continuing from previous invocation
    if (state) {
      return await processContinuation(supabase, state, ELEVENLABS_API_KEY);
    }

    // Initial invocation - set up state
    let targetSessionId = session_id;

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

    console.log(`Starting session transcription for: ${targetSessionId}`);

    // Fetch all individual recordings
    const { data: recordings, error: fetchError } = await supabase
      .from('voice_recordings')
      .select('id, discord_username, discord_user_id, file_url, mp3_file_url, language, metadata')
      .eq('session_id', targetSessionId)
      .eq('recording_type', 'individual')
      .order('discord_user_id');

    if (fetchError) {
      console.error('Failed to fetch recordings:', fetchError);
      return json({ error: "Failed to fetch recordings" }, 500);
    }

    if (!recordings || recordings.length === 0) {
      return json({ 
        success: false, 
        error: "no_individual_tracks",
        message: "Não foram encontradas faixas individuais para esta sessão." 
      }, 200);
    }

    console.log(`Found ${recordings.length} individual recordings`);

    // Check which already have cached transcriptions
    const pendingIds: string[] = [];
    const alreadyProcessed: string[] = [];
    const allSegments: SpeakerSegment[] = [];
    const speakerMeta: SpeakerMeta[] = [];

    for (const rec of recordings as IndividualRecording[]) {
      const speaker = rec.discord_username || `User_${rec.discord_user_id.slice(-4)}`;
      const cachedWords = rec.metadata?.elevenlabs_words as ElevenLabsWord[] | undefined;
      
      if (cachedWords && cachedWords.length > 0) {
        console.log(`Using cached transcription for ${speaker}`);
        const segments = wordsToSegments(cachedWords, speaker);
        allSegments.push(...segments);
        speakerMeta.push({ username: speaker, user_id: rec.discord_user_id, has_transcription: true });
        alreadyProcessed.push(rec.id);
      } else {
        const audioUrl = rec.mp3_file_url || rec.file_url;
        if (audioUrl) {
          pendingIds.push(rec.id);
        } else {
          speakerMeta.push({ username: speaker, user_id: rec.discord_user_id, has_transcription: false });
        }
      }
    }

    // If all already cached, finalize immediately
    if (pendingIds.length === 0) {
      return await finalizeSession(supabase, {
        session_id: targetSessionId!,
        mixed_recording_id,
        pending_track_ids: [],
        processed_track_ids: alreadyProcessed,
        all_segments: allSegments,
        speaker_meta: speakerMeta
      });
    }

    // Process first pending track
    const initialState: SessionState = {
      session_id: targetSessionId!,
      mixed_recording_id,
      pending_track_ids: pendingIds,
      processed_track_ids: alreadyProcessed,
      all_segments: allSegments,
      speaker_meta: speakerMeta
    };

    return await processContinuation(supabase, initialState, ELEVENLABS_API_KEY);

  } catch (error) {
    console.error('Error:', error);
    return json({ error: "Failed to aggregate transcriptions", details: String(error) }, 500);
  }
});

async function processContinuation(
  supabase: AnySupabaseClient,
  state: SessionState,
  apiKey: string
): Promise<Response> {
  if (state.pending_track_ids.length === 0) {
    return await finalizeSession(supabase, state);
  }

  // Process ONE track only to stay within memory limits
  const trackId = state.pending_track_ids[0];
  const remainingIds = state.pending_track_ids.slice(1);

  console.log(`Processing track ${trackId}, ${remainingIds.length} remaining`);

  const { data, error } = await supabase
    .from('voice_recordings')
    .select('id, discord_username, discord_user_id, file_url, mp3_file_url, language, metadata')
    .eq('id', trackId)
    .single();

  if (error || !data) {
    console.error(`Failed to fetch track ${trackId}:`, error);
    // Skip this track, continue with rest
    return await scheduleContinuation(supabase, {
      ...state,
      pending_track_ids: remainingIds
    });
  }

  const rec = data as IndividualRecording;
  const speaker = rec.discord_username || `User_${rec.discord_user_id.slice(-4)}`;
  const audioUrl = rec.mp3_file_url || rec.file_url;

  if (!audioUrl) {
    console.log(`No audio URL for ${speaker}, skipping`);
    state.speaker_meta.push({ username: speaker, user_id: rec.discord_user_id, has_transcription: false });
    return await scheduleContinuation(supabase, {
      ...state,
      pending_track_ids: remainingIds
    });
  }

  try {
    console.log(`Transcribing track for ${speaker}...`);
    const words = await transcribeWithElevenLabs(audioUrl, apiKey, rec.language);

    if (words.length > 0) {
      // Cache words in metadata
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
      state.all_segments.push(...segments);
      state.speaker_meta.push({ username: speaker, user_id: rec.discord_user_id, has_transcription: true });
    } else {
      state.speaker_meta.push({ username: speaker, user_id: rec.discord_user_id, has_transcription: false });
    }

    state.processed_track_ids.push(trackId);
  } catch (err) {
    console.error(`Failed to transcribe ${speaker}:`, err);
    state.speaker_meta.push({ username: speaker, user_id: rec.discord_user_id, has_transcription: false });
  }

  // Schedule continuation for remaining tracks
  return await scheduleContinuation(supabase, {
    ...state,
    pending_track_ids: remainingIds
  });
}

async function scheduleContinuation(
  supabase: AnySupabaseClient,
  state: SessionState
): Promise<Response> {
  if (state.pending_track_ids.length === 0) {
    return await finalizeSession(supabase, state);
  }

  console.log(`Scheduling continuation for ${state.pending_track_ids.length} remaining tracks`);

  // Fire-and-forget continuation
  supabase.functions.invoke('transcribe-session', {
    body: { state }
  }).catch((err: Error) => console.error('Continuation invoke error:', err));

  return json({
    success: true,
    status: 'processing',
    session_id: state.session_id,
    processed: state.processed_track_ids.length,
    pending: state.pending_track_ids.length,
    message: `Processando ${state.pending_track_ids.length} faixas restantes...`
  });
}

async function finalizeSession(
  supabase: AnySupabaseClient,
  state: SessionState
): Promise<Response> {
  console.log(`Finalizing session ${state.session_id}`);

  if (state.all_segments.length === 0) {
    return json({
      success: false,
      error: "no_transcriptions",
      message: "Nenhuma faixa individual foi transcrita com sucesso."
    }, 200);
  }

  // Sort by start time
  state.all_segments.sort((a, b) => a.start - b.start);
  const mergedSegments = mergeAdjacentSegments(state.all_segments);

  const timelineTranscription = mergedSegments
    .map(seg => `[${seg.speaker}]: ${seg.text}`)
    .join('\n\n');

  // Update mixed recording if provided
  if (state.mixed_recording_id) {
    const { error: updateError } = await supabase
      .from('voice_recordings')
      .update({
        transcription_elevenlabs: timelineTranscription,
        transcription_elevenlabs_status: 'completed',
        metadata: {
          speaker_segments: mergedSegments,
          speakers: state.speaker_meta,
          aggregated_at: new Date().toISOString()
        }
      })
      .eq('id', state.mixed_recording_id);

    if (updateError) {
      console.error('Failed to update mixed recording:', updateError);
    }
  }

  return json({
    success: true,
    session_id: state.session_id,
    speakers: state.speaker_meta,
    transcription: timelineTranscription,
    segment_count: mergedSegments.length,
    stats: {
      total_tracks: state.processed_track_ids.length + state.speaker_meta.filter(s => !s.has_transcription).length,
      transcribed: state.speaker_meta.filter(s => s.has_transcription).length
    }
  });
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function wordsToSegments(words: ElevenLabsWord[], speaker: string): SpeakerSegment[] {
  if (words.length === 0) return [];

  const segments: SpeakerSegment[] = [];
  let currentSegment: { words: string[]; start: number; end: number } | null = null;
  const PAUSE_THRESHOLD = 1.5;

  for (const word of words) {
    const text = word.text.trim();
    if (!text) continue;

    if (!currentSegment) {
      currentSegment = { words: [text], start: word.start, end: word.end };
      continue;
    }

    const gap = word.start - currentSegment.end;
    const endsWithPunctuation = /[.!?]$/.test(currentSegment.words[currentSegment.words.length - 1]);

    if (gap > PAUSE_THRESHOLD || endsWithPunctuation) {
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

function mergeAdjacentSegments(segments: SpeakerSegment[]): SpeakerSegment[] {
  if (segments.length === 0) return [];

  const merged: SpeakerSegment[] = [];
  let current = { ...segments[0] };

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
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
  // Stream download with size limit
  const resp = await fetch(audioUrl);
  if (!resp.ok) throw new Error(`Failed to download audio: ${resp.status}`);

  const contentLength = parseInt(resp.headers.get('content-length') || '0');
  if (contentLength > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large: ${(contentLength / 1024 / 1024).toFixed(1)}MB`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large: ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)}MB`);
  }

  // Detect format
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
  formData.append("file", new Blob([arrayBuffer], { type: mimeType }), filename);
  formData.append("model_id", "scribe_v2");
  formData.append("timestamps_granularity", "word");

  if (language) {
    const langMap: Record<string, string> = {
      pt: "por", en: "eng", es: "spa", fr: "fra", de: "deu",
      it: "ita", ja: "jpn", ko: "kor", zh: "zho", ru: "rus"
    };
    formData.append("language_code", langMap[language.toLowerCase()] || language);
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
  return (result.words || []) as ElevenLabsWord[];
}
