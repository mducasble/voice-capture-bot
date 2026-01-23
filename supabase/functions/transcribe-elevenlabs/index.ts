import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ElevenLabs Scribe v2 limits (practical): keep uploads small to avoid edge runtime memory limits.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB
const CHUNKS_PER_INVOCATION = 3;
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
      .select("id, file_url, mp3_file_url, language, file_size_bytes, format")
      .eq("id", recording_id)
      .single();

    if (fetchError || !recording) {
      return json({ error: "Recording not found" }, 404);
    }

    if (mode === "full") {
      return await processFullMode(supabase, recording, ELEVENLABS_API_KEY);
    }

    // mode === 'chunks' - first check if chunks exist, fallback to full mode if not
    // Load current state from database (idempotent)
    const { data: currentRow } = await supabase
      .from("voice_recordings")
      .select("transcription_elevenlabs, elevenlabs_chunk_state")
      .eq("id", recording_id)
      .single();

    let chunkState: ChunkState | null = currentRow?.elevenlabs_chunk_state as ChunkState | null;

    // Check for lock - if another invocation is processing, skip gracefully (2xx so invoke() doesn't throw)
    if (chunkState?.lockedAt) {
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

    console.log(
      `Starting ElevenLabs transcription for ${recording_id}, mode: chunks, nextIndex=${chunkState.nextIndex}, total=${chunkState.chunkNames.length}`
    );

    const start = chunkState.nextIndex;
    const end = Math.min(start + CHUNKS_PER_INVOCATION, chunkState.chunkNames.length);

    const newParts: string[] = [];
    const existing = (currentRow?.transcription_elevenlabs as string | null) ?? "";

    for (let i = start; i < end; i++) {
      const name = chunkState.chunkNames[i];
      const chunkUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/voice-recordings/chunks/${name}`;

      console.log(`Transcribing chunk ${i + 1}/${chunkState.chunkNames.length}: ${name}`);

      // Detect format from chunk filename
      const isChunkMp3 = name.toLowerCase().endsWith('.mp3');
      const chunkFilename = isChunkMp3 ? "chunk.mp3" : "chunk.wav";
      const chunkMimeType = isChunkMp3 ? "audio/mpeg" : "audio/wav";

      try {
        const blob = await safeFetchBlob(chunkUrl, MAX_UPLOAD_BYTES);
        const t = await transcribeWithElevenLabs({
          audioBlob: blob,
          filename: chunkFilename,
          mimeType: chunkMimeType,
          apiKey: ELEVENLABS_API_KEY,
          language: recording.language ?? undefined,
        });
        if (t?.trim()) newParts.push(t.trim());
      } catch (e) {
        console.error(`Chunk failed: ${name}`, e);
        newParts.push(`[chunk ${i}] (falhou)`);
      }
    }

    // Join new parts with space (continuous text), then append to existing
    const newText = newParts.join(" ");
    const merged = existing.trim() ? `${existing.trim()} ${newText}` : newText;

    if (end >= chunkState.chunkNames.length) {
      // Completed - clear state and release lock
      await supabase
        .from("voice_recordings")
        .update({
          transcription_elevenlabs: merged,
          transcription_elevenlabs_status: merged.trim() ? "completed" : "failed",
          elevenlabs_chunk_state: null, // Clear state on completion
        })
        .eq("id", recording_id);

      console.log(`ElevenLabs chunks completed for ${recording_id}`);
      return json({ success: true, recording_id, mode: "chunks", done: true });
    }

    // Update state with new progress and RELEASE lock (continuation will re-acquire).
    // Keeping the lock here causes the self-scheduled continuation to immediately hit "locked" and stall.
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
      })
      .eq("id", recording_id);

    // Schedule continuation reliably
    const invokePromise = supabase.functions.invoke("transcribe-elevenlabs", {
      body: { recording_id, mode: "chunks" },
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

  console.log(`Starting ElevenLabs transcription for ${recording_id}, mode: full`);

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

  const transcription = await transcribeWithElevenLabs({
    audioBlob: blob,
    filename,
    mimeType,
    apiKey,
    language: recording.language ?? undefined,
  });

  await supabase
    .from("voice_recordings")
    .update({
      transcription_elevenlabs: transcription,
      transcription_elevenlabs_status: transcription ? "completed" : "failed",
    })
    .eq("id", recording_id);

  return json({ success: true, recording_id, mode: "full", transcription_length: transcription.length });
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

async function transcribeWithElevenLabs(params: {
  audioBlob: Blob;
  filename: string;
  mimeType: string;
  apiKey: string;
  language?: string;
}): Promise<string> {
  const { audioBlob, filename, mimeType, apiKey, language } = params;

  const formData = new FormData();
  formData.append("file", new Blob([audioBlob], { type: mimeType }), filename);
  formData.append("model_id", "scribe_v2");

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
  return result.text || "";
}
