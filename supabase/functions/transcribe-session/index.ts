import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { createMp3Encoder } from "https://esm.sh/wasm-media-encoders@0.7.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB for ElevenLabs
const MAX_WAV_FOR_CONVERSION = 2 * 1024 * 1024 * 1024; // 2GB max WAV to convert
const TARGET_SAMPLE_RATE = 16000;
const MP3_BITRATE = 128;

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
      .select('id, discord_username, discord_user_id, file_url, mp3_file_url, language, metadata, file_size_bytes')
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
        // Check if we have any usable audio
        const hasAudio = rec.mp3_file_url || rec.file_url;
        if (hasAudio) {
          pendingIds.push(rec.id);
        } else {
          speakerMeta.push({ username: speaker, user_id: rec.discord_user_id, has_transcription: false, error: 'no_audio' });
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
    .select('id, discord_username, discord_user_id, file_url, mp3_file_url, language, metadata, file_size_bytes')
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

  try {
    console.log(`Processing track for ${speaker}...`);
    
    // Get or create MP3 file URL
    let audioUrl = rec.mp3_file_url;
    
    if (!audioUrl && rec.file_url) {
      // Need to convert WAV to MP3
      const fileSize = rec.file_size_bytes || 0;
      console.log(`No MP3 available for ${speaker}, WAV size: ${(fileSize / 1024 / 1024).toFixed(1)}MB`);
      
      if (fileSize > MAX_WAV_FOR_CONVERSION) {
        throw new Error(`File too large to convert: ${(fileSize / 1024 / 1024).toFixed(0)}MB`);
      }
      
      // Convert WAV to MP3 using streaming
      audioUrl = await convertWavToMp3(supabase, rec.id, rec.file_url, speaker);
      
      if (audioUrl) {
        // Update record with new MP3 URL
        await supabase
          .from('voice_recordings')
          .update({ mp3_file_url: audioUrl })
          .eq('id', rec.id);
        console.log(`Saved MP3 URL for ${speaker}`);
      }
    }
    
    if (!audioUrl) {
      throw new Error('No audio URL available');
    }

    // Check MP3 file size
    const headResp = await fetch(audioUrl, { method: 'HEAD' });
    const mp3Size = parseInt(headResp.headers.get('content-length') || '0');
    console.log(`MP3 size for ${speaker}: ${(mp3Size / 1024 / 1024).toFixed(1)}MB`);
    
    if (mp3Size > MAX_UPLOAD_BYTES) {
      throw new Error(`MP3 still too large: ${(mp3Size / 1024 / 1024).toFixed(1)}MB (limit: 25MB)`);
    }

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
      state.speaker_meta.push({ username: speaker, user_id: rec.discord_user_id, has_transcription: false, error: 'no_speech' });
    }

    state.processed_track_ids.push(trackId);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to process ${speaker}:`, errorMsg);
    state.speaker_meta.push({ username: speaker, user_id: rec.discord_user_id, has_transcription: false, error: errorMsg });
  }

  // Schedule continuation for remaining tracks
  return await scheduleContinuation(supabase, {
    ...state,
    pending_track_ids: remainingIds
  });
}

// Convert WAV to MP3 using streaming to avoid memory issues
async function convertWavToMp3(
  supabase: AnySupabaseClient,
  recordingId: string,
  wavUrl: string,
  speaker: string
): Promise<string | null> {
  console.log(`Converting WAV to MP3 for ${speaker}...`);
  
  // Fetch WAV header first
  const headerResp = await fetch(wavUrl, { headers: { 'Range': 'bytes=0-1023' } });
  if (!headerResp.ok) {
    throw new Error(`Failed to fetch WAV header: ${headerResp.status}`);
  }
  
  const headerBytes = new Uint8Array(await headerResp.arrayBuffer());
  const wavInfo = parseWavHeader(headerBytes);
  
  if (!wavInfo) {
    throw new Error('Invalid WAV file format');
  }
  
  console.log(`WAV: ${wavInfo.sampleRate}Hz, ${wavInfo.channels}ch, data size: ${(wavInfo.dataSize / 1024 / 1024).toFixed(1)}MB`);
  
  // Calculate resampling ratio
  const ratio = wavInfo.sampleRate / TARGET_SAMPLE_RATE;
  const bytesPerFrame = wavInfo.channels * (wavInfo.bitsPerSample / 8);
  
  // Process in chunks to avoid memory issues (process 30 seconds at a time)
  const CHUNK_SECONDS = 30;
  const bytesPerChunk = Math.floor(wavInfo.sampleRate * CHUNK_SECONDS * bytesPerFrame);
  
  const encoder = await createMp3Encoder();
  encoder.configure({
    sampleRate: TARGET_SAMPLE_RATE,
    channels: 1,
    bitrate: MP3_BITRATE,
  });
  
  const mp3Chunks: Uint8Array[] = [];
  let bytesProcessed = 0;
  let srcIdx = 0;
  let outputSampleIdx = 0;
  
  while (bytesProcessed < wavInfo.dataSize) {
    const rangeStart = wavInfo.dataOffset + bytesProcessed;
    const rangeEnd = Math.min(rangeStart + bytesPerChunk - 1, wavInfo.dataOffset + wavInfo.dataSize - 1);
    
    const chunkResp = await fetch(wavUrl, {
      headers: { 'Range': `bytes=${rangeStart}-${rangeEnd}` }
    });
    
    if (!chunkResp.ok && chunkResp.status !== 206) {
      throw new Error(`Failed to fetch WAV chunk: ${chunkResp.status}`);
    }
    
    const chunkData = new Uint8Array(await chunkResp.arrayBuffer());
    const view = new DataView(chunkData.buffer, chunkData.byteOffset, chunkData.byteLength);
    
    // Resample and convert to mono
    const samples: number[] = [];
    let frameOffset = 0;
    
    while (frameOffset + bytesPerFrame <= chunkData.length) {
      const targetOutputIdx = Math.floor(srcIdx / ratio);
      
      if (targetOutputIdx > outputSampleIdx) {
        // Mix channels to mono
        let sample = 0;
        for (let ch = 0; ch < wavInfo.channels; ch++) {
          sample += view.getInt16(frameOffset + ch * 2, true);
        }
        const monoSample = sample / wavInfo.channels / 32768.0; // Normalize to -1 to 1
        samples.push(monoSample);
        outputSampleIdx++;
      }
      
      srcIdx++;
      frameOffset += bytesPerFrame;
    }
    
    bytesProcessed += frameOffset;
    
    // Encode samples to MP3
    if (samples.length > 0) {
      const floatSamples = new Float32Array(samples);
      const mp3Data = encoder.encode([floatSamples]);
      if (mp3Data.length > 0) {
        mp3Chunks.push(mp3Data);
      }
    }
    
    console.log(`Converted ${Math.round(bytesProcessed / wavInfo.dataSize * 100)}% for ${speaker}`);
  }
  
  // Finalize MP3
  const finalFrames = encoder.finalize();
  if (finalFrames.length > 0) {
    mp3Chunks.push(finalFrames);
  }
  
  // Combine all MP3 chunks
  const totalSize = mp3Chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const fullMp3 = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of mp3Chunks) {
    fullMp3.set(chunk, offset);
    offset += chunk.length;
  }
  
  console.log(`Created MP3: ${(fullMp3.length / 1024 / 1024).toFixed(2)}MB for ${speaker}`);
  
  // Upload to storage
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const mp3Path = `mp3/${recordingId}_${timestamp}.mp3`;
  
  const { error: uploadError } = await supabase.storage
    .from('voice-recordings')
    .upload(mp3Path, fullMp3, {
      contentType: 'audio/mpeg',
      upsert: true
    });
  
  if (uploadError) {
    console.error('Failed to upload MP3:', uploadError);
    throw new Error(`Failed to upload MP3: ${uploadError.message}`);
  }
  
  const { data: { publicUrl } } = supabase.storage
    .from('voice-recordings')
    .getPublicUrl(mp3Path);
  
  console.log(`Uploaded MP3 for ${speaker}: ${publicUrl}`);
  return publicUrl;
}

// Parse WAV header
function parseWavHeader(headerBytes: Uint8Array): { sampleRate: number; channels: number; bitsPerSample: number; dataOffset: number; dataSize: number } | null {
  if (headerBytes.length < 44) return null;
  
  const view = new DataView(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength);
  
  const riff = String.fromCharCode(headerBytes[0], headerBytes[1], headerBytes[2], headerBytes[3]);
  if (riff !== 'RIFF') return null;
  
  const wave = String.fromCharCode(headerBytes[8], headerBytes[9], headerBytes[10], headerBytes[11]);
  if (wave !== 'WAVE') return null;
  
  let offset = 12;
  let sampleRate = 48000;
  let channels = 2;
  let bitsPerSample = 16;
  let dataOffset = 0;
  let dataSize = 0;
  
  while (offset < Math.min(headerBytes.length - 8, 1000)) {
    const chunkId = String.fromCharCode(
      headerBytes[offset], headerBytes[offset + 1],
      headerBytes[offset + 2], headerBytes[offset + 3]
    );
    const chunkSize = view.getUint32(offset + 4, true);
    
    if (chunkId === 'fmt ') {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }
    
    offset += 8 + chunkSize;
    if (chunkSize % 2 !== 0) offset++;
  }
  
  if (dataOffset === 0) return null;
  return { sampleRate, channels, bitsPerSample, dataOffset, dataSize };
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
