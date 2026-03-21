import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ElevenLabs Scribe v2 limits (practical): keep uploads small to avoid edge runtime memory limits.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB
const CHUNKS_PER_GROUP = 10; // 10 chunks × 30s = ~5min per API call (better diarization)
const GROUPS_PER_INVOCATION = 1; // groups processed per edge function invocation
const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes - if locked longer, allow retry

type Mode = "chunks" | "full";

type ChunkState = {
  chunkNames: string[];
  nextIndex: number;
  lockedAt: string; // ISO timestamp
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const recording_id: string | undefined = body?.recording_id;
    const mode: Mode = body?.mode === "full" ? "full" : "chunks";
    const state: ChunkState | undefined = body?.state;
    const force: boolean = Boolean(body?.force);
    // Optional: limit the number of chunks to process (for testing purposes)
    const maxChunks: number | undefined = typeof body?.max_chunks === 'number' ? body.max_chunks : undefined;

    if (!recording_id) {
      return json({ error: "Missing recording_id" }, 400);
    }

    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVENLABS_API_KEY) {
      return json({ error: "ElevenLabs API key not configured" }, 500);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: recording, error: fetchError } = await supabase
      .from("voice_recordings")
      .select(
        "id, file_url, mp3_file_url, language, file_size_bytes, format, transcription_elevenlabs_status, transcription_elevenlabs, elevenlabs_chunk_state, metadata"
      )
      .eq("id", recording_id)
      .single();

    if (fetchError || !recording) {
      return json({ error: "Recording not found" }, 404);
    }

    // Idempotency guard: avoid re-processing an already completed transcription unless explicitly forced.
    // This is the most common source of unexpected credit usage (e.g., button clicked twice).
    if (!force && recording?.transcription_elevenlabs_status === "completed") {
      return json(
        {
          success: true,
          skipped: true,
          reason: "already_completed",
          recording_id,
          mode,
        },
        200
      );
    }

    // Credit-saving guard: For multi-track sessions, skip MIXED tracks
    // The individual tracks contain the real speaker names - mixed is redundant.
    // Use transcribe-session to aggregate individuals into a proper timeline.
    const recordingType = (recording as unknown as { recording_type?: string }).recording_type;
    const sessionId = (recording as unknown as { session_id?: string }).session_id;
    
    if (!force && recordingType === "mixed" && sessionId) {
      console.log(`Skipping mixed track ${recording_id} (session: ${sessionId}) - use transcribe-session instead for proper speaker attribution`);
      return json(
        {
          success: true,
          skipped: true,
          reason: "mixed_track_skipped",
          message: "Track 'mixed' pulado. Use 'Agregar Sessão' para transcrever com atribuição correta de speakers via tracks individuais.",
          recording_id,
          session_id: sessionId,
        },
        200
      );
    }

    if (mode === "full") {
      return await processFullMode(supabase, recording, ELEVENLABS_API_KEY);
    }

    // mode === 'chunks' - first check if chunks exist, fallback to full mode if not
    // Load current state from row (idempotent)
    const currentRow = recording as unknown as {
      transcription_elevenlabs: string | null;
      elevenlabs_chunk_state: ChunkState | null;
    };

    let chunkState: ChunkState | null = (currentRow?.elevenlabs_chunk_state as ChunkState | null) ?? null;

    // Check for lock - if another invocation is processing, skip gracefully (2xx so invoke() doesn't throw)
    // BUT: if status is "failed", always allow retry regardless of lock
    const statusIsFailed = recording?.transcription_elevenlabs_status === "failed";
    if (chunkState?.lockedAt && !statusIsFailed) {
      const lockAge = Date.now() - new Date(chunkState.lockedAt).getTime();
      if (lockAge < LOCK_TIMEOUT_MS) {
        console.log(`Recording ${recording_id} is locked (age: ${Math.round(lockAge / 1000)}s). Skipping.`);
        return json(
          { success: true, skipped: true, reason: "Already processing", lockedFor: Math.round(lockAge / 1000) },
          200
        );
      }
      console.log(`Lock expired for ${recording_id} (age: ${Math.round(lockAge / 1000)}s). Resuming.`);
    }
    if (statusIsFailed && chunkState?.lockedAt) {
      console.log(`Recording ${recording_id} status is failed — ignoring stale lock, allowing retry.`);
      chunkState = { ...chunkState, lockedAt: "" };
    }

    // Build initial state if not present
    if (!chunkState || !chunkState.chunkNames?.length) {
      try {
        chunkState = await buildInitialChunkState(supabase, recording_id);
      } catch (_e) {
        // No chunks found.
        // If this is a WAV, we can kick off processing to generate chunks.
        // If it's a large non-WAV file, we can't safely upload full-mode (>25MB) in this runtime.

        const audioUrl = recording.mp3_file_url || recording.file_url;
        const format = (recording as unknown as { format: string | null }).format;
        const fileSizeBytes = (recording as unknown as { file_size_bytes: number | null }).file_size_bytes;

        const isWav =
          (format?.toLowerCase?.() === "wav") ||
          (audioUrl ? audioUrl.toLowerCase().includes(".wav") : false);

        if (audioUrl && isWav) {
          console.log(`No chunks found for ${recording_id}. Starting process-audio to generate chunks...`);

          // Mark as processing and kick off chunk generation.
          await supabase
            .from("voice_recordings")
            .update({ transcription_elevenlabs_status: "processing" })
            .eq("id", recording_id);

          const { error: processError } = await supabase.functions.invoke("process-audio", {
            body: { recording_id, audio_url: audioUrl },
          });

          if (processError) {
            console.error("Failed to start process-audio:", processError);
            await supabase
              .from("voice_recordings")
              .update({ transcription_elevenlabs_status: "failed" })
              .eq("id", recording_id);

            return json(
              {
                success: false,
                recording_id,
                error: "no_chunks",
                message: "Não foram encontrados chunks e não foi possível iniciar o processamento do áudio.",
              },
              200
            );
          }

          // Poll every 30s until chunks are ready, then start transcription
          const MAX_POLLS = 20; // 20 × 30s = 10 minutes max wait
          const POLL_INTERVAL_MS = 30_000;

          const pollAndTranscribe = async () => {
            for (let attempt = 1; attempt <= MAX_POLLS; attempt++) {
              await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
              console.log(`[poll ${attempt}/${MAX_POLLS}] Checking chunks for ${recording_id}...`);

              try {
                const tempState = await buildInitialChunkState(supabase, recording_id);
                if (tempState && tempState.chunkNames.length > 0) {
                  console.log(`Chunks ready for ${recording_id} (${tempState.chunkNames.length} chunks). Starting transcription.`);
                  await supabase.functions.invoke("transcribe-elevenlabs", {
                    body: { recording_id, mode: "chunks" },
                  });
                  return;
                }
              } catch {
                console.log(`[poll ${attempt}] No chunks yet for ${recording_id}`);
              }
            }
            console.error(`Timeout waiting for chunks for ${recording_id} after ${MAX_POLLS} polls`);
            await supabase
              .from("voice_recordings")
              .update({ transcription_elevenlabs_status: "failed" })
              .eq("id", recording_id);
          };

          // @ts-ignore EdgeRuntime available
          if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
            // @ts-ignore
            EdgeRuntime.waitUntil(pollAndTranscribe());
          }

          return json(
            {
              success: true,
              recording_id,
              mode: "chunks",
              scheduled_processing: true,
              scheduled_function: "process-audio",
            },
            200
          );
        }

        // If we know it's big, don't even try full mode.
        if (fileSizeBytes && fileSizeBytes > MAX_UPLOAD_BYTES) {
          await supabase
            .from("voice_recordings")
            .update({ transcription_elevenlabs_status: "failed" })
            .eq("id", recording_id);

          return json(
            {
              success: false,
              recording_id,
              error: "file_too_large",
              message:
                "Arquivo >25MB e sem chunks. Para transcrever, faça upload em WAV (para gerar chunks) ou envie um arquivo menor.",
            },
            200
          );
        }

        // Fallback to full mode only for small, non-chunked files.
        try {
          console.log(`No chunks found for ${recording_id}, falling back to full mode`);
          return await processFullMode(supabase, recording, ELEVENLABS_API_KEY);
        } catch (err) {
          const msg = String(err);
          console.error("Full mode fallback failed:", msg);

          await supabase
            .from("voice_recordings")
            .update({ transcription_elevenlabs_status: "failed" })
            .eq("id", recording_id);

          return json(
            {
              success: false,
              recording_id,
              error: msg.includes("File too large") ? "file_too_large" : "no_chunks",
              message: msg.includes("File too large")
                ? "Arquivo >25MB e sem chunks. Para transcrever, faça upload em WAV (para gerar chunks) ou envie um arquivo menor."
                : "Não foram encontrados chunks para este áudio.",
            },
            200
          );
        }
      }
    }

    // Acquire lock and update state in DB
    const now = new Date().toISOString();
    chunkState = { ...chunkState, lockedAt: now };

    await supabase
      .from("voice_recordings")
      .update({
        transcription_elevenlabs_status: "processing",
        elevenlabs_chunk_state: chunkState,
      })
      .eq("id", recording_id);

    // Determine the effective total chunks (respecting maxChunks limit for testing)
    const effectiveTotalChunks = maxChunks 
      ? Math.min(maxChunks, chunkState.chunkNames.length) 
      : chunkState.chunkNames.length;

    // Calculate which group(s) to process in this invocation
    const start = chunkState.nextIndex;
    // Process GROUPS_PER_INVOCATION groups, each containing CHUNKS_PER_GROUP chunks
    const groupEnd = Math.min(start + GROUPS_PER_INVOCATION * CHUNKS_PER_GROUP, effectiveTotalChunks);

    console.log(
      `Starting ElevenLabs transcription for ${recording_id}, mode: chunks (grouped), chunkRange=${start}-${groupEnd - 1}, total=${effectiveTotalChunks}${maxChunks ? ` (limited to ${maxChunks})` : ''}, groupSize=${CHUNKS_PER_GROUP}`
    );

    const newParts: string[] = [];
    const existing = (currentRow?.transcription_elevenlabs as string | null) ?? "";

    // Track words across all chunks for diarization
    const allWords: ElevenLabsWord[] = [];
    const CHUNK_DURATION_SECONDS = 30;

    // Process chunks in groups of CHUNKS_PER_GROUP
    for (let groupStart = start; groupStart < groupEnd; groupStart += CHUNKS_PER_GROUP) {
      const groupEndIdx = Math.min(groupStart + CHUNKS_PER_GROUP, groupEnd);
      const groupChunkCount = groupEndIdx - groupStart;
      
      console.log(`Processing group: chunks ${groupStart}-${groupEndIdx - 1} (${groupChunkCount} chunks, ~${groupChunkCount * 30}s)`);

      try {
        // Download all chunks in the group
        const chunkBlobs: Blob[] = [];
        let isGroupMp3 = true;

        for (let i = groupStart; i < groupEndIdx; i++) {
          const name = chunkState.chunkNames[i];
          const chunkUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/voice-recordings/chunks/${name}`;
          
          console.log(`  Downloading chunk ${i + 1}/${chunkState.chunkNames.length}: ${name}`);
          const blob = await safeFetchBlob(chunkUrl, MAX_UPLOAD_BYTES);
          chunkBlobs.push(blob);
          
          if (!name.toLowerCase().endsWith('.mp3')) isGroupMp3 = false;
        }

        // Concatenate all chunk blobs into a single blob
        const mergedBlob = new Blob(chunkBlobs, { type: isGroupMp3 ? "audio/mpeg" : "audio/wav" });
        const mergedFilename = isGroupMp3 ? "merged_group.mp3" : "merged_group.wav";
        const mergedMimeType = isGroupMp3 ? "audio/mpeg" : "audio/wav";

        console.log(`  Merged group: ${(mergedBlob.size / 1024 / 1024).toFixed(1)}MB, sending to ElevenLabs...`);

        const result = await transcribeWithElevenLabsDiarized({
          audioBlob: mergedBlob,
          filename: mergedFilename,
          mimeType: mergedMimeType,
          apiKey: ELEVENLABS_API_KEY,
          // Don't send language for grouped chunks - auto-detect works better for diarization
          language: undefined,
        });

        // Log speaker distribution for debugging
        const speakersFound = new Set((result.words || []).map(w => w.speaker_id || w.speaker).filter(Boolean));
        console.log(`  Group result: ${result.words?.length || 0} words, speakers found: [${[...speakersFound].join(', ')}], text length: ${result.text?.length || 0}`);

        // Add words with adjusted timestamps for the group's offset
        const groupOffset = groupStart * CHUNK_DURATION_SECONDS;
        if (result.words && result.words.length > 0) {
          for (const word of result.words) {
            allWords.push({
              text: word.text,
              start: word.start + groupOffset,
              end: word.end + groupOffset,
              speaker: word.speaker_id || word.speaker,
            });
          }
        }

        if (result.text?.trim()) newParts.push(result.text.trim());
      } catch (e: any) {
        console.error(`Group ${groupStart}-${groupEndIdx - 1} failed:`, e);

        // If quota exceeded, stop immediately and save progress
        if (e?.isQuotaExceeded) {
          console.error("Quota exceeded - stopping processing immediately");

          const newText = newParts.join(" ");
          const merged = existing.trim() ? `${existing.trim()} ${newText}` : newText;

          await supabase
            .from("voice_recordings")
            .update({
              transcription_elevenlabs: merged || null,
              transcription_elevenlabs_status: "failed",
              elevenlabs_chunk_state: {
                ...chunkState,
                nextIndex: groupStart,
                lockedAt: "",
                error: "quota_exceeded"
              },
            })
            .eq("id", recording_id);

          return json({
            success: false,
            recording_id,
            error: "quota_exceeded",
            message: "Créditos ElevenLabs esgotados. Progresso salvo para retomar depois.",
            chunks_completed: groupStart,
            total_chunks: chunkState.chunkNames.length,
          });
        }

        newParts.push(`[group ${groupStart}-${groupEndIdx - 1}] (falhou)`);
      }
    }

    const end = groupEnd;

    // Join new parts with space (continuous text), then append to existing
    const newText = newParts.join(" ");
    const merged = existing.trim() ? `${existing.trim()} ${newText}` : newText;

    // Get existing metadata to accumulate words across invocations
    const { data: currentRecData } = await supabase
      .from("voice_recordings")
      .select("metadata")
      .eq("id", recording_id)
      .single();
    
    const existingMeta = (currentRecData?.metadata as Record<string, unknown> | null) ?? {};
    const existingWords = (existingMeta.accumulated_words as ElevenLabsWord[] | null) ?? [];
    const accumulatedWords = [...existingWords, ...allWords];

    if (end >= effectiveTotalChunks) {
      // Completed - process all accumulated words into speaker segments
      const segments = wordsToSegments(accumulatedWords);
      const { formatted: formattedSegments, mapping: speakerMapping } = formatSegmentsForExport(segments);
      
      const hasSpeakers = formattedSegments.length > 0;
      const jsonTranscription = hasSpeakers ? stringifySegments(formattedSegments) : merged;
      const readableTranscription = hasSpeakers 
        ? formattedSegments.map(seg => `[${seg.speaker}]: ${seg.text}`).join('\n\n')
        : merged;

      // Clear accumulated words and state, save final results
      await supabase
        .from("voice_recordings")
        .update({
          transcription_elevenlabs: jsonTranscription,
          transcription_elevenlabs_status: merged.trim() ? "completed" : "failed",
          elevenlabs_chunk_state: null,
          metadata: {
            ...existingMeta,
            accumulated_words: null, // Clear accumulated words
            elevenlabs_words: accumulatedWords, // Persist word-level timestamps for review
            speaker_segments: hasSpeakers ? formattedSegments : undefined,
            speaker_mapping: hasSpeakers ? speakerMapping : undefined,
            readable_transcription: hasSpeakers ? readableTranscription : undefined,
            transcribed_at: new Date().toISOString(),
          },
        })
        .eq("id", recording_id);

      console.log(`ElevenLabs chunks completed for ${recording_id} with ${formattedSegments.length} speaker segments`);
      return json({ 
        success: true, 
        recording_id, 
        mode: "chunks", 
        done: true,
        diarized: hasSpeakers,
        speaker_count: Object.keys(speakerMapping).length,
        segment_count: formattedSegments.length,
      });
    }

    // Update state with new progress and RELEASE lock (continuation will re-acquire).
    // Also save accumulated words for final diarization processing.
    const nextState: ChunkState = {
      chunkNames: chunkState.chunkNames,
      nextIndex: end,
      lockedAt: "", // release
    };

    await supabase
      .from("voice_recordings")
      .update({
        transcription_elevenlabs: merged,
        elevenlabs_chunk_state: nextState,
        metadata: {
          ...existingMeta,
          accumulated_words: accumulatedWords, // Save words for final diarization
        },
      })
      .eq("id", recording_id);

    // Schedule continuation reliably (pass maxChunks to maintain limit through invocations)
    const invokePromise = supabase.functions.invoke("transcribe-elevenlabs", {
      body: { recording_id, mode: "chunks", max_chunks: maxChunks },
    });

    // @ts-ignore EdgeRuntime available
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(
        invokePromise
          .then(({ error }: { error?: unknown }) => {
            if (error) console.error("Failed to schedule continuation:", error);
          })
          .catch((err: unknown) => console.error("Failed to schedule continuation:", err))
      );
    } else {
      const { error } = await invokePromise;
      if (error) console.error("Failed to schedule continuation:", error);
    }

    return json({ success: true, recording_id, mode: "chunks", done: false, nextIndex: end });
  } catch (error) {
    console.error("Error:", error);

    // Best effort status update
    try {
      const cloned = req.clone();
      const { recording_id } = await cloned.json();
      if (recording_id) {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
        );
        await supabase
          .from("voice_recordings")
          .update({ transcription_elevenlabs_status: "failed" })
          .eq("id", recording_id);
      }
    } catch {
      // ignore
    }

    return json({ error: "Transcription failed", details: String(error) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
async function processFullMode(
  supabase: any,
  recording: { id: string; file_url: string | null; mp3_file_url: string | null; language: string | null },
  apiKey: string
): Promise<Response> {
  const recording_id = recording.id;
  
  await supabase
    .from("voice_recordings")
    .update({ transcription_elevenlabs_status: "processing" })
    .eq("id", recording_id);

  console.log(`Starting ElevenLabs transcription for ${recording_id}, mode: full (with diarization)`);

  // Prefer the pre-generated compressed file if available; fallback to original.
  const audioUrl = recording.mp3_file_url || recording.file_url;
  if (!audioUrl) throw new Error("No audio file available");

  // Safety: never attempt to upload huge files.
  const blob = await safeFetchBlob(audioUrl, MAX_UPLOAD_BYTES);

  // Detect format from URL
  const urlLower = audioUrl.toLowerCase();
  let filename = "audio.wav";
  let mimeType = "audio/wav";
  
  if (urlLower.includes(".mp3")) {
    filename = "audio.mp3";
    mimeType = "audio/mpeg";
  } else if (urlLower.includes(".mkv")) {
    filename = "audio.mkv";
    mimeType = "video/x-matroska";
  } else if (urlLower.includes(".m4a")) {
    filename = "audio.m4a";
    mimeType = "audio/mp4";
  } else if (urlLower.includes(".ogg")) {
    filename = "audio.ogg";
    mimeType = "audio/ogg";
  }

  const result = await transcribeWithElevenLabsDiarized({
    audioBlob: blob,
    filename,
    mimeType,
    apiKey,
    language: recording.language ?? undefined,
  });

  // Process words into speaker segments if diarization data is available
  const words = result.words || [];
  const segments = wordsToSegments(words);
  const { formatted: formattedSegments, mapping: speakerMapping } = formatSegmentsForExport(segments);

  // Create JSON transcription with guaranteed property order
  const jsonTranscription = stringifySegments(formattedSegments);

  // Create readable transcription
  const readableTranscription = formattedSegments
    .map(seg => `[${seg.speaker}]: ${seg.text}`)
    .join('\n\n');

  // Fetch existing metadata to preserve other fields
  const { data: existingRec } = await supabase
    .from("voice_recordings")
    .select("metadata")
    .eq("id", recording_id)
    .single();

  const existingMetadata = (existingRec?.metadata as Record<string, unknown> | null) ?? {};

  const hasSpeakers = formattedSegments.length > 0;

  await supabase
    .from("voice_recordings")
    .update({
      transcription_elevenlabs: hasSpeakers ? jsonTranscription : result.text,
      transcription_elevenlabs_status: result.text ? "completed" : "failed",
      metadata: {
        ...existingMetadata,
        elevenlabs_words: words.length > 0 ? words : undefined, // Persist word-level timestamps for review
        speaker_segments: hasSpeakers ? formattedSegments : undefined,
        speaker_mapping: hasSpeakers ? speakerMapping : undefined,
        readable_transcription: hasSpeakers ? readableTranscription : undefined,
        transcribed_at: new Date().toISOString(),
      },
    })
    .eq("id", recording_id);

  return json({ 
    success: true, 
    recording_id, 
    mode: "full", 
    diarized: hasSpeakers,
    speaker_count: Object.keys(speakerMapping).length,
    segment_count: formattedSegments.length,
    transcription_length: result.text?.length || 0 
  });
}

async function buildInitialChunkState(supabase: any, recording_id: string): Promise<ChunkState> {
  const { data: files, error } = await supabase.storage
    .from("voice-recordings")
    .list("chunks", { search: recording_id });

  if (error) throw new Error(`Failed to list chunks: ${error.message}`);

  const chunkNames = (files || [])
    .map((f: { name: string }) => f.name)
    .filter((name: string) => name.includes(recording_id) && name.includes("_chunk"))
    .sort((a: string, b: string) => {
      const ia = parseInt(a.match(/chunk(\d+)/)?.[1] || "0");
      const ib = parseInt(b.match(/chunk(\d+)/)?.[1] || "0");
      return ia - ib;
    });

  if (chunkNames.length === 0) {
    throw new Error("No chunks found for this recording. Use mode=full (only works for small files).");
  }

  return { chunkNames, nextIndex: 0, lockedAt: "" };
}

async function safeFetchBlob(url: string, maxBytes: number): Promise<Blob> {
  // Try HEAD first
  try {
    const head = await fetch(url, { method: "HEAD" });
    if (head.ok) {
      const len = parseInt(head.headers.get("content-length") || "0");
      if (len && len > maxBytes) {
        throw new Error(`File too large (${(len / 1024 / 1024).toFixed(1)}MB). Use chunks mode.`);
      }
    }
  } catch {
    // ignore and fallback to streaming GET below
  }

  const resp = await fetch(url);
  if (!resp.ok || !resp.body) throw new Error(`Failed to download audio: ${resp.status}`);

  const reader = resp.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let received = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      received += value.length;
      if (received > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        throw new Error(`File too large (>${(maxBytes / 1024 / 1024).toFixed(0)}MB). Use chunks mode.`);
      }
      // Use a copied ArrayBuffer to avoid SharedArrayBuffer typing issues in edge runtime
      chunks.push(value.slice().buffer);
    }
  }

  return new Blob(chunks);
}

type ElevenLabsWord = {
  text: string;
  start: number;
  end: number;
  speaker?: string;
  speaker_id?: string;
  type?: string;
  logprob?: number;
};

type ElevenLabsResponse = {
  text: string;
  words?: ElevenLabsWord[];
};

type SpeakerSegment = {
  start: number;
  end: number;
  speaker: string;
  text: string;
};

type FormattedSegment = {
  start: string;
  end: string;
  speaker: string;
  text: string;
};

async function transcribeWithElevenLabs(params: {
  audioBlob: Blob;
  filename: string;
  mimeType: string;
  apiKey: string;
  language?: string;
}): Promise<string> {
  const result = await transcribeWithElevenLabsDiarized(params);
  return result.text || "";
}

async function transcribeWithElevenLabsDiarized(params: {
  audioBlob: Blob;
  filename: string;
  mimeType: string;
  apiKey: string;
  language?: string;
}): Promise<ElevenLabsResponse> {
  const { audioBlob, filename, mimeType, apiKey, language } = params;

  const formData = new FormData();
  formData.append("file", new Blob([audioBlob], { type: mimeType }), filename);
  formData.append("model_id", "scribe_v2");
  formData.append("diarize", "true"); // Enable speaker diarization
  formData.append("tag_audio_events", "true");

  if (language) {
    const langMap: Record<string, string> = {
      pt: "por",
      en: "eng",
      es: "spa",
      fr: "fra",
      de: "deu",
      it: "ita",
      ja: "jpn",
      ko: "kor",
      zh: "zho",
      ru: "rus",
      hi: "hin",
      ar: "ara",
      bn: "ben",
      tr: "tur",
      vi: "vie",
      th: "tha",
      pl: "pol",
      nl: "nld",
      sv: "swe",
      uk: "ukr",
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
    
    // Check for quota exceeded error
    if (response.status === 401 && errText.includes("quota_exceeded")) {
      const error = new Error(`QUOTA_EXCEEDED: ${errText}`);
      (error as any).isQuotaExceeded = true;
      throw error;
    }
    
    throw new Error(`ElevenLabs API error: ${response.status}`);
  }

  const data = await response.json();
  
  // Debug: log response structure to understand diarization output
  const sampleWord = data.words?.[0];
  const wordKeys = sampleWord ? Object.keys(sampleWord) : [];
  const uniqueSpeakers = new Set((data.words || []).map((w: any) => w.speaker_id || w.speaker || w.speaker_label).filter(Boolean));
  console.log(`  ElevenLabs response keys: ${Object.keys(data).join(', ')}`);
  console.log(`  Sample word keys: [${wordKeys.join(', ')}], sample: ${JSON.stringify(sampleWord)}`);
  console.log(`  Unique speakers (speaker/speaker_id/speaker_label): [${[...uniqueSpeakers].join(', ')}]`);
  
  return data;
}

// Stringify segments with guaranteed property order: start, end, speaker, text
function stringifySegments(segments: FormattedSegment[], pretty = false): string {
  const ordered = segments.map(seg => ({
    start: seg.start,
    end: seg.end,
    speaker: seg.speaker,
    text: seg.text,
  }));
  return pretty ? JSON.stringify(ordered, null, 2) : JSON.stringify(ordered);
}

// Format seconds to "HH:MM:SS.mmm"
function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

// Convert words with speaker info into segments (group consecutive words from same speaker)
function wordsToSegments(words: ElevenLabsWord[]): SpeakerSegment[] {
  if (!words || words.length === 0) return [];

  // Defensive normalization:
  // - Filter out whitespace-only "words" (ElevenLabs API artifact)
  // - Ensure chronological order (prevents inverted time ranges)
  // - Clamp end >= start
  const normalizedWords = words
    .filter((w) =>
      typeof w?.start === "number" &&
      typeof w?.end === "number" &&
      Number.isFinite(w.start) &&
      Number.isFinite(w.end) &&
      w.text?.trim() // Filter out whitespace-only entries
    )
    .map((w) => ({ ...w, text: w.text.trim(), end: Math.max(w.end, w.start) }))
    .sort((a, b) => (a.start - b.start) || (a.end - b.end));

  const segments: SpeakerSegment[] = [];
  let currentSegment: SpeakerSegment | null = null;
  const SILENCE_THRESHOLD = 1.5; // seconds - start new segment after silence
  const SENTENCE_END_RE = /[.!?;]$/; // Break segments at sentence boundaries too

  for (const word of normalizedWords) {
    const speaker = word.speaker_id || word.speaker || "speaker_0";
    
    // Start new segment if: first word, different speaker, long silence, or after sentence end
    const prevEndedSentence = currentSegment && SENTENCE_END_RE.test(currentSegment.text);
    const shouldStartNew = !currentSegment ||
      currentSegment.speaker !== speaker ||
      (word.start - currentSegment.end > SILENCE_THRESHOLD) ||
      (prevEndedSentence && word.start - currentSegment.end > 0.3);

    if (shouldStartNew) {
      if (currentSegment) {
        segments.push(currentSegment);
      }
      currentSegment = {
        start: word.start,
        end: word.end,
        speaker,
        text: word.text,
      };
    } else if (currentSegment) {
      currentSegment.end = Math.max(currentSegment.end, word.end);
      currentSegment.text += ` ${word.text}`;
    }
  }

  if (currentSegment) {
    segments.push(currentSegment);
  }

  return segments;
}

// Format segments for JSON export with speaker labels (speaker A, B, etc.)
function formatSegmentsForExport(segments: SpeakerSegment[]): { formatted: FormattedSegment[]; mapping: Record<string, string> } {
  const speakerMap = new Map<string, string>();
  const letterCode = (n: number) => String.fromCharCode(65 + n); // 65 = 'A'

  const formatted = segments.map(seg => {
    if (!speakerMap.has(seg.speaker)) {
      speakerMap.set(seg.speaker, `speaker_${letterCode(speakerMap.size)}`);
    }

    return {
      start: formatTimestamp(seg.start),
      end: formatTimestamp(seg.end),
      speaker: speakerMap.get(seg.speaker)!,
      text: seg.text.trim(),
    };
  });

  // Create reverse mapping for display
  const mapping: Record<string, string> = {};
  speakerMap.forEach((label, original) => {
    mapping[label] = original;
  });

  return { formatted, mapping };
}
