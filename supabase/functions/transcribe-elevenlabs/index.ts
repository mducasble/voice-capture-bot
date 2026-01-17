import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ElevenLabs Scribe v2 limits (practical): keep uploads small to avoid edge runtime memory limits.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB
const CHUNKS_PER_INVOCATION = 3;

type Mode = "chunks" | "full";

type ChunkState = {
  recording_id: string;
  mode: "chunks";
  chunkNames: string[];
  nextIndex: number;
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
      .select("id, file_url, mp3_file_url, language")
      .eq("id", recording_id)
      .single();

    if (fetchError || !recording) {
      return json({ error: "Recording not found" }, 404);
    }

    if (mode === "full") {
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

      const isMp3 = audioUrl.toLowerCase().includes(".mp3");
      const filename = isMp3 ? "audio.mp3" : "audio.wav";
      const mimeType = isMp3 ? "audio/mpeg" : "audio/wav";

      const transcription = await transcribeWithElevenLabs({
        audioBlob: blob,
        filename,
        mimeType,
        apiKey: ELEVENLABS_API_KEY,
        language: recording.language ?? undefined,
      });

      await supabase
        .from("voice_recordings")
        .update({
          transcription_elevenlabs: transcription,
          transcription_elevenlabs_status: transcription ? "completed" : "failed",
        })
        .eq("id", recording_id);

      return json({ success: true, recording_id, mode, transcription_length: transcription.length });
    }

    // mode === 'chunks'
    const chunkState = state ?? (await buildInitialChunkState(supabase, recording_id));

    // Mark processing (idempotent)
    await supabase
      .from("voice_recordings")
      .update({ transcription_elevenlabs_status: "processing" })
      .eq("id", recording_id);

    console.log(
      `Starting ElevenLabs transcription for ${recording_id}, mode: chunks, nextIndex=${chunkState.nextIndex}, total=${chunkState.chunkNames.length}`
    );

    const start = chunkState.nextIndex;
    const end = Math.min(start + CHUNKS_PER_INVOCATION, chunkState.chunkNames.length);

    // Load existing partial transcription from DB to keep state small.
    const { data: currentRow } = await supabase
      .from("voice_recordings")
      .select("transcription_elevenlabs")
      .eq("id", recording_id)
      .single();

    const newParts: string[] = [];
    const existing = (currentRow?.transcription_elevenlabs as string | null) ?? "";

    for (let i = start; i < end; i++) {
      const name = chunkState.chunkNames[i];
      const chunkUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/voice-recordings/chunks/${name}`;

      console.log(`Transcribing chunk ${i + 1}/${chunkState.chunkNames.length}: ${name}`);

      try {
        const blob = await safeFetchBlob(chunkUrl, MAX_UPLOAD_BYTES);
        const t = await transcribeWithElevenLabs({
          audioBlob: blob,
          filename: "chunk.wav",
          mimeType: "audio/wav",
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
    await supabase
      .from("voice_recordings")
      .update({ transcription_elevenlabs: merged })
      .eq("id", recording_id);

    if (end >= chunkState.chunkNames.length) {
      await supabase
        .from("voice_recordings")
        .update({
          transcription_elevenlabs_status: merged.trim() ? "completed" : "failed",
        })
        .eq("id", recording_id);

      console.log(`ElevenLabs chunks completed for ${recording_id}`);
      return json({ success: true, recording_id, mode: "chunks", done: true });
    }

    const nextState: ChunkState = { ...chunkState, nextIndex: end };

    // Schedule continuation reliably
    const invokePromise = supabase.functions.invoke("transcribe-elevenlabs", {
      body: { recording_id, mode: "chunks", state: nextState },
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

  return { recording_id, mode: "chunks", chunkNames, nextIndex: 0 };
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
