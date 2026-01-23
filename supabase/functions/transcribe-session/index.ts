import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Keep each upload small to avoid edge runtime memory/CPU limits.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB
const CHUNKS_PER_INVOCATION = 3; // per track, per invocation
const CHUNK_DURATION_SECONDS = 30; // must match process-audio

interface SessionState {
  session_id: string;
  mixed_recording_id?: string;
  pending_track_ids: string[];
  processed_track_ids: string[];
  all_segments: SpeakerSegment[];
  speaker_meta: SpeakerMeta[];

  // When a single track is being transcribed chunk-by-chunk, we keep progress here.
  current_track?: {
    track_id: string;
    speaker: string;
    user_id: string;
    language: string | null;
    chunkUrls: { url: string; index: number }[];
    nextIndex: number;
    track_segments: SpeakerSegment[];
  };
}

interface SpeakerMeta {
  username: string;
  user_id: string;
  has_transcription: boolean;
  error?: string;
}

interface IndividualRecording {
  id: string;
  discord_username: string | null;
  discord_user_id: string;
  file_url: string | null;
  mp3_file_url: string | null;
  language: string | null;
  metadata: Record<string, unknown> | null;
  file_size_bytes: number | null;
  gemini_chunk_state?: {
    chunkUrls?: { url: string; index: number }[];
  } | null;
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

// Output format matching the expected JSON structure
interface FormattedSegment {
  start: string;   // e.g., "0:02"
  end: string;     // e.g., "0:07"
  speaker: string; // e.g., "speaker A"
  text: string;
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
      .select('id, discord_username, discord_user_id, file_url, mp3_file_url, language, metadata, file_size_bytes, gemini_chunk_state')
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
      const cachedSegments = rec.metadata?.elevenlabs_segments as SpeakerSegment[] | undefined;
      
      if (cachedSegments && cachedSegments.length > 0) {
        console.log(`Using cached segments for ${speaker}`);
        allSegments.push(...cachedSegments);
        setSpeakerMeta(speakerMeta, { username: speaker, user_id: rec.discord_user_id, has_transcription: true });
        alreadyProcessed.push(rec.id);
      } else if (cachedWords && cachedWords.length > 0) {
        console.log(`Using cached transcription for ${speaker}`);
        const segments = wordsToSegments(cachedWords, speaker);
        allSegments.push(...segments);
        setSpeakerMeta(speakerMeta, { username: speaker, user_id: rec.discord_user_id, has_transcription: true });
        alreadyProcessed.push(rec.id);
      } else {
        // Check if we have any usable audio
        const hasAudio = rec.mp3_file_url || rec.file_url;
        if (hasAudio) {
          pendingIds.push(rec.id);
        } else {
          setSpeakerMeta(speakerMeta, { username: speaker, user_id: rec.discord_user_id, has_transcription: false, error: 'no_audio' });
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
  // If we are mid-track, continue chunk processing first.
  if (state.current_track) {
    return await processCurrentTrackChunks(supabase, state, apiKey);
  }

  if (state.pending_track_ids.length === 0) {
    return await finalizeSession(supabase, state);
  }

  // Start processing the next track (chunk-by-chunk)
  const trackId = state.pending_track_ids[0];
  const remainingIds = state.pending_track_ids.slice(1);

  console.log(`Processing track ${trackId}, ${remainingIds.length} remaining`);

  const { data, error } = await supabase
    .from('voice_recordings')
    .select('id, discord_username, discord_user_id, file_url, mp3_file_url, language, metadata, file_size_bytes, gemini_chunk_state')
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

  // 1) Use cached segments/words if available
  const cachedSegments = rec.metadata?.elevenlabs_segments as SpeakerSegment[] | undefined;
  const cachedWords = rec.metadata?.elevenlabs_words as ElevenLabsWord[] | undefined;
  if (cachedSegments && cachedSegments.length > 0) {
    state.all_segments.push(...cachedSegments);
    setSpeakerMeta(state.speaker_meta, { username: speaker, user_id: rec.discord_user_id, has_transcription: true });
    state.processed_track_ids.push(trackId);
    return await scheduleContinuation(supabase, { ...state, pending_track_ids: remainingIds });
  }
  if (cachedWords && cachedWords.length > 0) {
    const segments = wordsToSegments(cachedWords, speaker);
    state.all_segments.push(...segments);
    setSpeakerMeta(state.speaker_meta, { username: speaker, user_id: rec.discord_user_id, has_transcription: true });
    state.processed_track_ids.push(trackId);
    return await scheduleContinuation(supabase, { ...state, pending_track_ids: remainingIds });
  }

  // 2) Prefer chunkUrls from process-audio (stored in gemini_chunk_state)
  const chunkUrls = rec.gemini_chunk_state?.chunkUrls;
  if (!chunkUrls || chunkUrls.length === 0) {
    // Kick off chunk generation (process-audio) and tell client to retry.
    const audioUrl = rec.file_url;
    if (!audioUrl) {
      setSpeakerMeta(state.speaker_meta, { username: speaker, user_id: rec.discord_user_id, has_transcription: false, error: 'no_audio' });
      state.processed_track_ids.push(trackId);
      return await scheduleContinuation(supabase, { ...state, pending_track_ids: remainingIds });
    }

    console.log(`No chunks for ${trackId}. Starting process-audio...`);
    await supabase.functions.invoke('process-audio', { body: { recording_id: trackId, audio_url: audioUrl } });

    // Add speaker to meta as pending so UI shows all speakers
    setSpeakerMeta(state.speaker_meta, { username: speaker, user_id: rec.discord_user_id, has_transcription: false, error: 'generating_chunks' });

    // Put the track back at the end of the queue so other tracks can proceed.
    // Instead of returning early, continue with other tracks if available.
    const updatedPendingIds = [...remainingIds, trackId]; // Move this track to end of queue
    
    // Update aggregation state to show waiting status
    if (state.mixed_recording_id) {
      try {
        const { data: mixedRec } = await supabase
          .from('voice_recordings')
          .select('metadata')
          .eq('id', state.mixed_recording_id)
          .single();

        const existingMetadata = (mixedRec?.metadata as Record<string, unknown> | null) ?? {};
        await supabase
          .from('voice_recordings')
          .update({
            metadata: {
              ...existingMetadata,
              aggregation_state: {
                status: 'processing',
                processed_count: state.processed_track_ids.length,
                pending_count: updatedPendingIds.length,
                current_speaker: speaker,
                waiting_for_chunks: true,
                speakers: state.speaker_meta,
                updated_at: new Date().toISOString()
              }
            }
          })
          .eq('id', state.mixed_recording_id);
      } catch (e) {
        console.error('Failed to update aggregation state:', e);
      }
    }

    // If there are other tracks to process, continue with them
    if (remainingIds.length > 0) {
      console.log(`Moving ${speaker} to end of queue, continuing with other tracks...`);
      return await scheduleContinuation(supabase, { ...state, pending_track_ids: updatedPendingIds });
    }

    // No other tracks - tell client to retry later
    return json({
      success: false,
      status: 'waiting',
      session_id: state.session_id,
      waiting_for: speaker,
      message: `Gerando chunks para ${speaker}. Tente novamente em alguns instantes.`
    }, 200);
  }

  // 3) Start chunk transcription for this track (progress stored in state.current_track)
  const nextState: SessionState = {
    ...state,
    pending_track_ids: remainingIds,
    current_track: {
      track_id: trackId,
      speaker,
      user_id: rec.discord_user_id,
      language: rec.language,
      chunkUrls: chunkUrls,
      nextIndex: 0,
      track_segments: [],
    }
  };

  return await processCurrentTrackChunks(supabase, nextState, apiKey);
}

async function processCurrentTrackChunks(
  supabase: AnySupabaseClient,
  state: SessionState,
  apiKey: string
): Promise<Response> {
  const current = state.current_track;
  if (!current) return json({ error: 'missing_current_track' }, 500);

  const start = current.nextIndex;
  const end = Math.min(start + CHUNKS_PER_INVOCATION, current.chunkUrls.length);
  console.log(`Track ${current.track_id}: processing chunks ${start}-${end - 1} of ${current.chunkUrls.length}`);

  for (let i = start; i < end; i++) {
    const chunk = current.chunkUrls[i];
    const offsetSeconds = (chunk.index ?? i) * CHUNK_DURATION_SECONDS;

    try {
      const { blob, mimeType, filename } = await safeFetchAudioBlob(chunk.url, MAX_UPLOAD_BYTES);
      const words = await transcribeWithElevenLabsWords({
        audioBlob: blob,
        mimeType,
        filename,
        apiKey,
        language: current.language ?? undefined,
      });

      const shiftedWords = words.map((w) => ({
        ...w,
        start: w.start + offsetSeconds,
        end: w.end + offsetSeconds,
      }));

      const segs = wordsToSegments(shiftedWords, current.speaker);
      current.track_segments.push(...segs);
      state.all_segments.push(...segs);
    } catch (e) {
      console.error(`Chunk failed for track ${current.track_id} (chunk idx=${i}):`, e);
    }
  }

  current.nextIndex = end;

  // Track complete
  if (current.nextIndex >= current.chunkUrls.length) {
    console.log(`Track ${current.track_id} completed. segments=${current.track_segments.length}`);

    // Cache segments (more compact than full word list) on the individual recording
    try {
      const { data: row } = await supabase
        .from('voice_recordings')
        .select('metadata')
        .eq('id', current.track_id)
        .single();

      const metadata = (row?.metadata as Record<string, unknown> | null) ?? {};
      await supabase
        .from('voice_recordings')
        .update({
          metadata: {
            ...metadata,
            elevenlabs_segments: current.track_segments,
            elevenlabs_segments_at: new Date().toISOString(),
          }
        })
        .eq('id', current.track_id);
    } catch (e) {
      console.error('Failed to cache segments on individual recording:', e);
    }

    setSpeakerMeta(state.speaker_meta, {
      username: current.speaker,
      user_id: current.user_id,
      has_transcription: current.track_segments.length > 0,
      error: current.track_segments.length > 0 ? undefined : 'no_speech',
    });

    state.processed_track_ids.push(current.track_id);
    state.current_track = undefined;

    return await scheduleContinuation(supabase, state);
  }

  // Continue same track
  return await scheduleContinuation(supabase, state);
}

async function scheduleContinuation(
  supabase: AnySupabaseClient,
  state: SessionState
): Promise<Response> {
  const pending = state.pending_track_ids.length + (state.current_track ? 1 : 0);

  if (pending === 0) {
    return await finalizeSession(supabase, state);
  }

  console.log(`Scheduling continuation: pending=${pending}, processed=${state.processed_track_ids.length}`);

  // Update aggregation state on mixed recording for real-time UI feedback
  if (state.mixed_recording_id) {
    try {
      const { data: mixedRec } = await supabase
        .from('voice_recordings')
        .select('metadata')
        .eq('id', state.mixed_recording_id)
        .single();

      const existingMetadata = (mixedRec?.metadata as Record<string, unknown> | null) ?? {};
      await supabase
        .from('voice_recordings')
        .update({
          metadata: {
            ...existingMetadata,
            aggregation_state: {
              status: 'processing',
              processed_count: state.processed_track_ids.length,
              pending_count: pending,
              current_speaker: state.current_track?.speaker || null,
              current_chunk: state.current_track?.nextIndex || null,
              total_chunks: state.current_track?.chunkUrls?.length || null,
              speakers: state.speaker_meta,
              updated_at: new Date().toISOString()
            }
          }
        })
        .eq('id', state.mixed_recording_id);
    } catch (e) {
      console.error('Failed to update aggregation state:', e);
    }
  }

  const invokePromise = supabase.functions.invoke('transcribe-session', {
    body: { state }
  });

  // @ts-ignore - EdgeRuntime is available in edge runtime
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(
      invokePromise
        .then(({ error }: { error?: unknown }) => {
          if (error) console.error('Continuation invoke error:', error);
        })
        .catch((err: unknown) => console.error('Continuation invoke error:', err))
    );
  } else {
    // Fallback: await so the request is not dropped.
    const { error } = await invokePromise;
    if (error) console.error('Continuation invoke error:', error);
  }

  return json({
    success: true,
    status: 'processing',
    session_id: state.session_id,
    processed: state.processed_track_ids.length,
    pending,
    message: `Processando... (${state.processed_track_ids.length} concluídas, ${pending} pendentes)`
  });
}

async function finalizeSession(
  supabase: AnySupabaseClient,
  state: SessionState
): Promise<Response> {
  console.log(`Finalizing session ${state.session_id}`);

  // Check for any transcribed content
  const successfulSpeakers = state.speaker_meta.filter(s => s.has_transcription);
  const failedSpeakers = state.speaker_meta.filter(s => !s.has_transcription);
  
  if (failedSpeakers.length > 0) {
    console.log(`Failed speakers: ${failedSpeakers.map(s => `${s.username}(${s.error})`).join(', ')}`);
  }

  if (state.all_segments.length === 0) {
    const errorDetails = failedSpeakers.map(s => `${s.username}: ${s.error}`).join('; ');
    return json({
      success: false,
      error: "no_transcriptions",
      message: `Nenhuma faixa foi transcrita. Erros: ${errorDetails}`
    }, 200);
  }

  // Sort by start time
  state.all_segments.sort((a, b) => a.start - b.start);
  const mergedSegments = mergeAdjacentSegments(state.all_segments);

  // Generate formatted JSON output (matching the expected format)
  const formattedSegments = formatSegmentsForExport(mergedSegments);
  // Stringify with guaranteed property order: start, end, speaker, text
  const jsonTranscription = JSON.stringify(
    formattedSegments.map(seg => ({
      start: seg.start,
      end: seg.end,
      speaker: seg.speaker,
      text: seg.text,
    })),
    null,
    2
  );

  // Also generate a human-readable version for display
  const readableTranscription = mergedSegments
    .map(seg => `[${seg.speaker}]: ${seg.text}`)
    .join('\n\n');

  // Create speaker mapping info for reference
  const speakerMapping: Record<string, string> = {};
  const letterCode = (n: number) => String.fromCharCode(65 + n);
  const uniqueSpeakers = [...new Set(mergedSegments.map(s => s.speaker))];
  uniqueSpeakers.forEach((speaker, i) => {
    speakerMapping[`speaker ${letterCode(i)}`] = speaker;
  });

  // Update mixed recording if provided
  if (state.mixed_recording_id) {
    // Fetch existing metadata to preserve other fields
    const { data: mixedRec } = await supabase
      .from('voice_recordings')
      .select('metadata')
      .eq('id', state.mixed_recording_id)
      .single();

    const existingMetadata = (mixedRec?.metadata as Record<string, unknown> | null) ?? {};
    
    // Remove aggregation_state as processing is complete
    const { aggregation_state: _, ...cleanedMetadata } = existingMetadata;

    const { error: updateError } = await supabase
      .from('voice_recordings')
      .update({
        transcription_elevenlabs: jsonTranscription,
        transcription_elevenlabs_status: 'completed',
        metadata: {
          ...cleanedMetadata,
          speaker_segments: formattedSegments,
          speaker_segments_raw: mergedSegments,
          speaker_mapping: speakerMapping,
          speakers: state.speaker_meta,
          readable_transcription: readableTranscription,
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
    speaker_mapping: speakerMapping,
    transcription: jsonTranscription,
    readable_transcription: readableTranscription,
    segment_count: formattedSegments.length,
    stats: {
      total_tracks: state.speaker_meta.length,
      transcribed: successfulSpeakers.length,
      failed: failedSpeakers.length
    }
  });
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Format seconds to "M:SS" or "H:MM:SS" for longer durations
function formatTimestamp(seconds: number): string {
  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

// Convert internal segments to the expected JSON format
function formatSegmentsForExport(segments: SpeakerSegment[]): FormattedSegment[] {
  // Create speaker mapping (discord username -> "speaker A", "speaker B", etc.)
  const speakerMap = new Map<string, string>();
  const letterCode = (n: number) => String.fromCharCode(65 + n); // 65 = 'A'
  
  return segments.map(seg => {
    if (!speakerMap.has(seg.speaker)) {
      speakerMap.set(seg.speaker, `speaker ${letterCode(speakerMap.size)}`);
    }
    
    return {
      start: formatTimestamp(seg.start),
      end: formatTimestamp(seg.end),
      speaker: speakerMap.get(seg.speaker)!,
      text: seg.text,
    };
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
  // Download the audio file
  const resp = await fetch(audioUrl);
  if (!resp.ok) throw new Error(`Failed to download audio: ${resp.status}`);

  const arrayBuffer = await resp.arrayBuffer();
  console.log(`Downloaded ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)}MB for transcription`);

  // Detect format from URL
  const urlLower = audioUrl.toLowerCase();
  let filename = "audio.mp3";
  let mimeType = "audio/mpeg";

  if (urlLower.includes(".wav")) {
    filename = "audio.wav";
    mimeType = "audio/wav";
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
  console.log(`Transcription complete: ${result.words?.length || 0} words`);
  return (result.words || []) as ElevenLabsWord[];
}

function setSpeakerMeta(list: SpeakerMeta[], meta: SpeakerMeta) {
  const idx = list.findIndex((s) => s.user_id === meta.user_id);
  if (idx >= 0) list[idx] = { ...list[idx], ...meta };
  else list.push(meta);
}

async function safeFetchAudioBlob(url: string, maxBytes: number): Promise<{ blob: Blob; mimeType: string; filename: string }> {
  // HEAD size check
  try {
    const head = await fetch(url, { method: 'HEAD' });
    if (head.ok) {
      const len = parseInt(head.headers.get('content-length') || '0');
      if (len && len > maxBytes) throw new Error(`File too large: ${(len / 1024 / 1024).toFixed(1)}MB`);
    }
  } catch {
    // ignore
  }

  const resp = await fetch(url);
  if (!resp.ok || !resp.body) throw new Error(`Failed to download chunk: ${resp.status}`);

  const reader = resp.body.getReader();
  const parts: ArrayBuffer[] = [];
  let received = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      received += value.length;
      if (received > maxBytes) {
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new Error(`File too large (>${(maxBytes / 1024 / 1024).toFixed(0)}MB)`);
      }
      parts.push(value.slice().buffer);
    }
  }

  const lower = url.toLowerCase();
  let filename = 'chunk.wav';
  let mimeType = 'audio/wav';
  if (lower.includes('.mp3')) { filename = 'chunk.mp3'; mimeType = 'audio/mpeg'; }
  else if (lower.includes('.m4a')) { filename = 'chunk.m4a'; mimeType = 'audio/mp4'; }
  else if (lower.includes('.ogg')) { filename = 'chunk.ogg'; mimeType = 'audio/ogg'; }

  return { blob: new Blob(parts), mimeType, filename };
}

async function transcribeWithElevenLabsWords(params: {
  audioBlob: Blob;
  filename: string;
  mimeType: string;
  apiKey: string;
  language?: string;
}): Promise<ElevenLabsWord[]> {
  const { audioBlob, filename, mimeType, apiKey, language } = params;

  const formData = new FormData();
  formData.append('file', new Blob([audioBlob], { type: mimeType }), filename);
  formData.append('model_id', 'scribe_v2');
  formData.append('timestamps_granularity', 'word');

  if (language) {
    const langMap: Record<string, string> = {
      pt: 'por', en: 'eng', es: 'spa', fr: 'fra', de: 'deu',
      it: 'ita', ja: 'jpn', ko: 'kor', zh: 'zho', ru: 'rus'
    };
    formData.append('language_code', langMap[language.toLowerCase()] || language);
  }

  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('ElevenLabs API error:', response.status, errText);
    throw new Error(`ElevenLabs API error: ${response.status}`);
  }

  const result = await response.json();
  return (result.words || []) as ElevenLabsWord[];
}
