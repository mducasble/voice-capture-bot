export interface AudioMetadata {
  durationSeconds: number | null;
  sampleRate: number | null;
  channels: number | null;
  bitDepth: number | null;
  format: string | null;
}

interface WavHeaderMetadata {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  durationSeconds: number | null;
}

const EXTENSION_TO_FORMAT: Record<string, string> = {
  wav: "wav",
  mp3: "mp3",
  m4a: "m4a",
  ogg: "ogg",
  mkv: "mkv",
};

const MIME_TO_FORMAT: Record<string, string> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/m4a": "m4a",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "video/x-matroska": "mkv",
  "audio/x-matroska": "mkv",
};

const getFormatFromFile = (file: File | Blob, filenameHint?: string): string | null => {
  const hintedName = filenameHint ?? (file instanceof File ? file.name : "");
  const ext = hintedName.split(".").pop()?.toLowerCase();

  if (ext && EXTENSION_TO_FORMAT[ext]) {
    return EXTENSION_TO_FORMAT[ext];
  }

  return MIME_TO_FORMAT[file.type] ?? null;
};

const parseWavHeader = (arrayBuffer: ArrayBuffer): WavHeaderMetadata | null => {
  if (arrayBuffer.byteLength < 44) return null;

  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);

  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const wave = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (riff !== "RIFF" || wave !== "WAVE") return null;

  let offset = 12;
  let sampleRate: number | null = null;
  let channels: number | null = null;
  let bitDepth: number | null = null;
  let dataSize: number | null = null;

  while (offset + 8 <= bytes.byteLength) {
    const chunkId = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === "fmt " && offset + 24 <= bytes.byteLength) {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitDepth = view.getUint16(offset + 22, true);
    }

    if (chunkId === "data") {
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (!sampleRate || !channels || !bitDepth) return null;

  const bytesPerSecond = sampleRate * channels * (bitDepth / 8);
  const durationSeconds = dataSize && bytesPerSecond > 0 ? dataSize / bytesPerSecond : null;

  return {
    sampleRate,
    channels,
    bitDepth,
    durationSeconds,
  };
};

const getDurationFromAudioElement = async (file: File | Blob): Promise<number | null> => {
  const objectUrl = URL.createObjectURL(file);

  try {
    const duration = await new Promise<number | null>((resolve) => {
      const audio = document.createElement("audio");
      audio.preload = "metadata";

      const cleanup = () => {
        audio.removeAttribute("src");
        audio.load();
      };

      audio.onloadedmetadata = () => {
        const value = Number(audio.duration);
        cleanup();
        resolve(Number.isFinite(value) && value > 0 ? value : null);
      };

      audio.onerror = () => {
        cleanup();
        resolve(null);
      };

      audio.src = objectUrl;
    });

    return duration;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

export const getAudioMetadata = async (file: File | Blob, filenameHint?: string): Promise<AudioMetadata> => {
  const format = getFormatFromFile(file, filenameHint);
  const arrayBuffer = await file.arrayBuffer();

  const wavHeader = parseWavHeader(arrayBuffer);

  let durationSeconds: number | null = wavHeader?.durationSeconds ?? null;
  let sampleRate: number | null = wavHeader?.sampleRate ?? null;
  let channels: number | null = wavHeader?.channels ?? null;
  const bitDepth: number | null = wavHeader?.bitDepth ?? null;

  const AudioContextCtor =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (AudioContextCtor) {
    const audioContext = new AudioContextCtor();
    try {
      const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      if (!durationSeconds) durationSeconds = decoded.duration;
      if (!sampleRate) sampleRate = decoded.sampleRate;
      if (!channels) channels = decoded.numberOfChannels;
    } catch {
      // Fall through to HTML audio metadata fallback.
    } finally {
      await audioContext.close();
    }
  }

  if (!durationSeconds) {
    durationSeconds = await getDurationFromAudioElement(file);
  }

  return {
    durationSeconds: durationSeconds && durationSeconds > 0 ? durationSeconds : null,
    sampleRate,
    channels,
    bitDepth,
    format,
  };
};
