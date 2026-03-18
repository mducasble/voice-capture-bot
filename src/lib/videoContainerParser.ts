/**
 * Video Container Metadata Parser
 * Parses MP4/MOV/M4V box structure to extract:
 * - Real FPS (from stts + mdhd)
 * - Codec info (from stsd)
 * - Device/model (from Apple metadata keys)
 * - Creation date, rotation, etc.
 */

export interface VideoContainerMetadata {
  containerFormat: string;
  codec: string | null;
  realFps: number | null;
  creationDate: string | null;
  deviceModel: string | null;
  deviceMake: string | null;
  software: string | null;
  rotation: number | null;
  bitrate: number | null;        // kbps
  colorProfile: string | null;
}

// ---------------------------------------------------------------------------
// Binary reader helpers
// ---------------------------------------------------------------------------

class BinaryReader {
  private view: DataView;
  private pos: number;
  private length: number;
  readonly buffer: ArrayBuffer;
  readonly byteOffset: number;

  constructor(buffer: ArrayBuffer, offset = 0, length?: number) {
    this.buffer = buffer;
    this.byteOffset = offset;
    this.view = new DataView(buffer, offset, length);
    this.pos = 0;
    this.length = length ?? buffer.byteLength - offset;
  }

  get remaining() { return this.length - this.pos; }
  get position() { return this.pos; }
  set position(p: number) { this.pos = p; }

  readUint8(): number { return this.view.getUint8(this.pos++); }

  readUint16(): number {
    const v = this.view.getUint16(this.pos);
    this.pos += 2;
    return v;
  }

  readUint32(): number {
    const v = this.view.getUint32(this.pos);
    this.pos += 4;
    return v;
  }

  readUint64(): number {
    const hi = this.view.getUint32(this.pos);
    const lo = this.view.getUint32(this.pos + 4);
    this.pos += 8;
    return hi * 0x100000000 + lo;
  }

  readInt32(): number {
    const v = this.view.getInt32(this.pos);
    this.pos += 4;
    return v;
  }

  readString(len: number): string {
    let s = "";
    for (let i = 0; i < len; i++) {
      const c = this.view.getUint8(this.pos++);
      if (c > 0) s += String.fromCharCode(c);
    }
    return s;
  }

  skip(n: number): void { this.pos += n; }

  slice(offset: number, length: number): BinaryReader {
    return new BinaryReader(this.buffer, this.byteOffset + offset, length);
  }
}

// ---------------------------------------------------------------------------
// MP4 Box parsing
// ---------------------------------------------------------------------------

interface Box {
  type: string;
  offset: number;
  size: number;
  headerSize: number;
}

function readBox(reader: BinaryReader): Box | null {
  if (reader.remaining < 8) return null;
  const offset = reader.position;
  let size = reader.readUint32();
  const type = reader.readString(4);
  let headerSize = 8;

  if (size === 1) {
    // 64-bit extended size
    size = reader.readUint64() as number;
    headerSize = 16;
  } else if (size === 0) {
    // Box extends to end of file
    size = reader.remaining + headerSize;
  }

  return { type, offset, size, headerSize };
}

// Container boxes that contain other boxes
const CONTAINER_BOXES = new Set([
  "moov", "trak", "mdia", "minf", "stbl", "udta", "meta", "ilst",
  "edts", "dinf", "sinf",
]);

// ---------------------------------------------------------------------------
// Parse functions
// ---------------------------------------------------------------------------

function parseStts(reader: BinaryReader): { sampleCount: number; sampleDelta: number }[] {
  reader.skip(4); // version + flags
  const entryCount = reader.readUint32();
  const entries: { sampleCount: number; sampleDelta: number }[] = [];
  for (let i = 0; i < entryCount && i < 100; i++) {
    entries.push({
      sampleCount: reader.readUint32(),
      sampleDelta: reader.readUint32(),
    });
  }
  return entries;
}

function parseMdhd(reader: BinaryReader): { timescale: number; duration: number } {
  const version = reader.readUint8();
  reader.skip(3); // flags

  if (version === 0) {
    reader.skip(8); // creation + modification time (32-bit)
    const timescale = reader.readUint32();
    const duration = reader.readUint32();
    return { timescale, duration };
  } else {
    reader.skip(16); // creation + modification time (64-bit)
    const timescale = reader.readUint32();
    const duration = reader.readUint64() as number;
    return { timescale, duration };
  }
}

function parseStsd(reader: BinaryReader): string | null {
  reader.skip(4); // version + flags
  const entryCount = reader.readUint32();
  if (entryCount === 0 || reader.remaining < 8) return null;

  reader.skip(4); // entry size
  const codec = reader.readString(4);
  return codec;
}

function parseMvhd(reader: BinaryReader): { timescale: number; duration: number } {
  const version = reader.readUint8();
  reader.skip(3);

  if (version === 0) {
    reader.skip(8);
    const timescale = reader.readUint32();
    const duration = reader.readUint32();
    return { timescale, duration };
  } else {
    reader.skip(16);
    const timescale = reader.readUint32();
    const duration = reader.readUint64() as number;
    return { timescale, duration };
  }
}

function parseTkhd(reader: BinaryReader): { rotation: number } {
  const version = reader.readUint8();
  reader.skip(3); // flags

  if (version === 0) {
    reader.skip(8 + 4 + 4 + 4 + 4 + 8); // times, trackID, reserved, duration, reserved
  } else {
    reader.skip(16 + 4 + 4 + 4 + 8 + 8); // 64-bit times
  }

  reader.skip(8); // layer, alternateGroup, volume, reserved

  // 3x3 transformation matrix (9 x int32, fixed point 16.16)
  const matrix: number[] = [];
  for (let i = 0; i < 9; i++) {
    matrix.push(reader.readInt32());
  }

  // Extract rotation from matrix
  const a = matrix[0] / 65536;
  const b = matrix[1] / 65536;
  let rotation = Math.round(Math.atan2(b, a) * (180 / Math.PI));
  if (rotation < 0) rotation += 360;

  return { rotation };
}

// Apple metadata keys in 'mdta' handler
function parseAppleMetadata(
  buffer: ArrayBuffer, boxOffset: number, boxSize: number
): { key: string; value: string }[] {
  const results: { key: string; value: string }[] = [];

  try {
    const reader = new BinaryReader(buffer, boxOffset, boxSize);

    // Look for 'keys' and 'ilst' boxes inside meta
    // Skip version/flags for meta box
    if (reader.remaining < 4) return results;
    reader.skip(4); // version + flags

    const keys: string[] = [];

    while (reader.remaining >= 8) {
      const box = readBox(reader);
      if (!box) break;

      const contentOffset = reader.position;
      const contentSize = box.size - box.headerSize;

      if (box.type === "keys" && contentSize > 0) {
        const keysReader = new BinaryReader(buffer, boxOffset + contentOffset, contentSize);
        keysReader.skip(4); // version + flags
        const count = keysReader.readUint32();
        for (let i = 0; i < count && keysReader.remaining >= 8; i++) {
          const keySize = keysReader.readUint32();
          keysReader.skip(4); // key namespace
          const keyName = keysReader.readString(keySize - 8);
          keys.push(keyName);
        }
      }

      if (box.type === "ilst" && contentSize > 0 && keys.length > 0) {
        const ilstReader = new BinaryReader(buffer, boxOffset + contentOffset, contentSize);
        let keyIndex = 0;

        while (ilstReader.remaining >= 8) {
          const itemBox = readBox(ilstReader);
          if (!itemBox) break;

          const itemContentSize = itemBox.size - itemBox.headerSize;
          if (itemContentSize > 8 && keyIndex < keys.length) {
            // Read data box inside
            const dataReader = new BinaryReader(
              buffer, boxOffset + contentOffset + ilstReader.position, itemContentSize
            );
            const dataBox = readBox(dataReader);
            if (dataBox && dataBox.type === "data") {
              dataReader.skip(4); // type indicator
              dataReader.skip(4); // locale
              const valueLen = dataBox.size - dataBox.headerSize - 8;
              if (valueLen > 0 && valueLen < 512) {
                const value = dataReader.readString(valueLen);
                results.push({ key: keys[keyIndex], value });
              }
            }
          }

          ilstReader.position = itemBox.offset - (boxOffset + contentOffset) + itemBox.size;
          keyIndex++;
        }
      }

      reader.position = contentOffset + contentSize;
    }
  } catch {
    // Metadata parsing is best-effort
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse video container metadata from a File.
 * Reads only the first 20MB to find the moov atom.
 */
export async function parseVideoContainer(file: File): Promise<VideoContainerMetadata> {
  const result: VideoContainerMetadata = {
    containerFormat: "unknown",
    codec: null,
    realFps: null,
    creationDate: null,
    deviceModel: null,
    deviceMake: null,
    software: null,
    rotation: null,
    bitrate: null,
    colorProfile: null,
  };

  // Read up to 20MB (moov is usually at start or end)
  const readSize = Math.min(file.size, 20 * 1024 * 1024);
  const buffer = await file.slice(0, readSize).arrayBuffer();
  const reader = new BinaryReader(buffer);

  // Detect format from ftyp
  const firstBox = readBox(reader);
  if (!firstBox) return result;

  if (firstBox.type === "ftyp") {
    reader.position = firstBox.offset + firstBox.headerSize;
    const brand = reader.readString(4);
    const brandMap: Record<string, string> = {
      "isom": "MP4", "mp41": "MP4", "mp42": "MP4",
      "M4V ": "M4V", "M4A ": "M4A",
      "qt  ": "MOV", "MSNV": "MP4 (Sony)",
      "avc1": "MP4 (H.264)",
    };
    result.containerFormat = brandMap[brand] || `MP4 (${brand.trim()})`;
    reader.position = firstBox.offset + firstBox.size;
  } else {
    reader.position = 0;
  }

  // Track data per track
  let movieTimescale = 0;
  let movieDuration = 0;
  let currentTrackTimescale = 0;
  let currentTrackDuration = 0;
  let sttsEntries: { sampleCount: number; sampleDelta: number }[] = [];
  let isVideoTrack = false;
  let foundVideoFps = false;

  // Walk top-level boxes
  const walkBoxes = (parentReader: BinaryReader, parentEnd: number, depth = 0) => {
    while (parentReader.position < parentEnd && parentReader.remaining >= 8) {
      const box = readBox(parentReader);
      if (!box || box.size < 8) break;

      const contentStart = parentReader.position;
      const contentEnd = box.offset + box.size;
      const contentSize = contentEnd - contentStart;

      try {
        if (box.type === "mvhd" && contentSize > 0) {
          const r = parentReader.slice(contentStart, contentSize);
          const mvhd = parseMvhd(r);
          movieTimescale = mvhd.timescale;
          movieDuration = mvhd.duration;

          // Estimate bitrate
          if (movieTimescale > 0 && movieDuration > 0) {
            const durationSec = movieDuration / movieTimescale;
            result.bitrate = Math.round((file.size * 8) / durationSec / 1000);
          }
        }

        if (box.type === "tkhd" && contentSize > 0) {
          const r = parentReader.slice(contentStart, contentSize);
          const tkhd = parseTkhd(r);
          result.rotation = tkhd.rotation === 0 ? null : tkhd.rotation;
        }

        if (box.type === "hdlr" && contentSize >= 12) {
          const r = parentReader.slice(contentStart, contentSize);
          r.skip(4); // version + flags
          r.skip(4); // pre-defined
          const handlerType = r.readString(4);
          isVideoTrack = handlerType === "vide";
        }

        if (box.type === "mdhd" && contentSize > 0) {
          const r = parentReader.slice(contentStart, contentSize);
          const mdhd = parseMdhd(r);
          currentTrackTimescale = mdhd.timescale;
          currentTrackDuration = mdhd.duration;
        }

        if (box.type === "stts" && contentSize > 0 && isVideoTrack && !foundVideoFps) {
          const r = parentReader.slice(contentStart, contentSize);
          sttsEntries = parseStts(r);

          // Calculate FPS from stts + mdhd timescale
          if (currentTrackTimescale > 0 && sttsEntries.length > 0) {
            // Use the most common sample delta
            let maxCount = 0;
            let dominantDelta = sttsEntries[0].sampleDelta;
            for (const e of sttsEntries) {
              if (e.sampleCount > maxCount) {
                maxCount = e.sampleCount;
                dominantDelta = e.sampleDelta;
              }
            }
            if (dominantDelta > 0) {
              result.realFps = Math.round((currentTrackTimescale / dominantDelta) * 100) / 100;
              foundVideoFps = true;
            }
          }
        }

        if (box.type === "stsd" && contentSize > 0 && isVideoTrack) {
          const r = parentReader.slice(contentStart, contentSize);
          const codec = parseStsd(r);
          if (codec) {
            const codecMap: Record<string, string> = {
              "avc1": "H.264", "avc3": "H.264",
              "hvc1": "H.265 (HEVC)", "hev1": "H.265 (HEVC)",
              "vp08": "VP8", "vp09": "VP9",
              "av01": "AV1",
              "mp4v": "MPEG-4",
              "ap4h": "ProRes 4444", "apch": "ProRes 422 HQ",
              "apcn": "ProRes 422", "apcs": "ProRes 422 LT",
            };
            result.codec = codecMap[codec] || codec;
          }
        }

        // Apple metadata in 'meta' box under 'udta'
        if (box.type === "meta" && contentSize > 0 && depth > 0) {
          const appleEntries = parseAppleMetadata(
            parentReader.slice(contentStart, contentSize).view.buffer,
            contentStart,
            contentSize,
          );

          // Actually parse from original buffer
          const entries = parseAppleMetadata(buffer, contentStart, contentSize);
          for (const { key, value } of entries) {
            const k = key.toLowerCase();
            if (k.includes("model") || k.includes("com.apple.quicktime.model")) {
              result.deviceModel = value;
            } else if (k.includes("make") || k.includes("com.apple.quicktime.make")) {
              result.deviceMake = value;
            } else if (k.includes("software") || k.includes("com.apple.quicktime.software")) {
              result.software = value;
            } else if (k.includes("creationdate") || k.includes("creation")) {
              result.creationDate = value;
            }
          }
        }

        // Recurse into container boxes
        if (CONTAINER_BOXES.has(box.type) && contentSize > 0) {
          const innerReader = parentReader.slice(contentStart, contentSize);

          // 'meta' box has a 4-byte version+flags before children
          if (box.type === "meta") {
            innerReader.skip(4);
          }

          walkBoxes(innerReader, contentSize, depth + 1);
        }
      } catch {
        // Best-effort parsing; skip broken boxes
      }

      parentReader.position = contentEnd;
    }
  };

  walkBoxes(reader, readSize, 0);

  return result;
}
