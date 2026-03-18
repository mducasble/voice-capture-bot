/**
 * Video QC Analysis Engine
 * Runs entirely in the browser using:
 * - MediaPipe Hands & Face Detection (via @mediapipe/tasks-vision)
 * - Canvas-based blur, lighting, and stability analysis
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QcConfig {
  fps: number;                  // frames to sample per second (1-3)
  minDurationSec: number;
  maxDurationSec: number;
  requiredOrientation: "landscape" | "portrait" | "any";
  weights: {
    handPresence: number;
    faceAbsence: number;
    durationCompliance: number;
    framing: number;
    blur: number;
    lighting: number;
    stability: number;
  };
  thresholds: {
    pass: number;
    warning: number;
  };
  hardBlockRules: {
    minHandPresenceRate: number;
    maxFacePresenceRate: number;
    minDurationSec: number;
    faceMinConfidence: number;
  };
}

export const DEFAULT_QC_CONFIG: QcConfig = {
  fps: 1,
  minDurationSec: 5,
  maxDurationSec: 600,
  requiredOrientation: "any",
  weights: {
    handPresence: 0.30,
    faceAbsence: 0.15,
    durationCompliance: 0.10,
    framing: 0.10,
    blur: 0.15,
    lighting: 0.10,
    stability: 0.10,
  },
  thresholds: {
    pass: 85,
    warning: 65,
  },
  hardBlockRules: {
    minHandPresenceRate: 0.20,
    maxFacePresenceRate: 0.50,
    minDurationSec: 3,
    faceMinConfidence: 0.70,
  },
};

export interface FrameAnalysis {
  time: number;
  handsDetected: number;
  handConfidence: number;
  handBboxes: { x: number; y: number; w: number; h: number }[];
  faceDetected: boolean;
  faceConfidence: number;
  blurScore: number;       // higher = sharper
  brightness: number;      // 0-255
  contrast: number;        // 0-255
  motionDelta: number;     // vs previous frame (total motion)
  cameraShake: number;     // global camera motion magnitude
  objectMotion: number;    // local object motion (hands, etc.)
}

export interface QcReport {
  // File metadata
  duration: number;
  width: number;
  height: number;
  fps: number;
  orientation: "landscape" | "portrait" | "square";
  hasAudio: boolean;
  fileSize: number;
  integrityPassed: boolean;

  // Hand metrics
  handPresenceRate: number;
  dualHandRate: number;
  handCenteringScore: number;
  handSizeScore: number;
  trackingContinuityScore: number;

  // Face metrics
  facePresenceRate: number;
  maxFaceDuration: number;

  // Quality metrics
  blurScore: number;
  brightnessScore: number;
  stabilityScore: number;

  // Computed
  qcScore: number;
  qcStatus: "PASS" | "WARNING" | "BLOCK";
  failureReasons: string[];
  warningReasons: string[];

  // Raw frames
  frames: FrameAnalysis[];
  analyzedFrames: number;
  totalFrames: number;
}

export type QcProgress = {
  phase: "init" | "sampling" | "analyzing" | "scoring" | "done";
  current: number;
  total: number;
  message: string;
};

// ---------------------------------------------------------------------------
// Blur detection (Laplacian variance)
// ---------------------------------------------------------------------------

function computeBlurScore(imageData: ImageData, analysisScale = 1): number {
  const { data, width, height } = imageData;
  // Convert to grayscale
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }

  // Laplacian kernel convolution
  let variance = 0;
  let mean = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const lap = -4 * gray[idx]
        + gray[idx - 1] + gray[idx + 1]
        + gray[idx - width] + gray[idx + width];
      mean += lap;
      variance += lap * lap;
      count++;
    }
  }

  mean /= count;
  variance = variance / count - mean * mean;

  // Compensate for downscaling: smaller images have less high-freq detail.
  // Laplacian variance scales roughly with the square of the scale factor.
  const scaleCompensation = analysisScale > 0 ? 1 / (analysisScale * analysisScale) : 1;
  const compensatedVariance = variance * scaleCompensation;

  // Normalize: compensated variance typically 0-2000 for sharp video, map to 0-100
  return Math.min(100, compensatedVariance / 20);
}

// ---------------------------------------------------------------------------
// Brightness & contrast
// ---------------------------------------------------------------------------

function computeLighting(imageData: ImageData): { brightness: number; contrast: number } {
  const { data } = imageData;
  let sum = 0;
  let sumSq = 0;
  const pixels = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += lum;
    sumSq += lum * lum;
  }

  const brightness = sum / pixels;
  const contrast = Math.sqrt(sumSq / pixels - brightness * brightness);

  return { brightness, contrast };
}

// ---------------------------------------------------------------------------
// Optical Flow – Block-matching with camera/object motion separation
// ---------------------------------------------------------------------------

interface FlowResult {
  totalMotion: number;   // average motion magnitude across all blocks
  cameraShake: number;   // magnitude of global (median) displacement
  objectMotion: number;  // residual local motion after subtracting camera motion
}

/**
 * Convert ImageData to grayscale Float32Array
 */
function toGrayscale(img: ImageData): Float32Array {
  const { data, width, height } = img;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }
  return gray;
}

/**
 * Block-matching optical flow.
 * Divides frame into a grid of blocks and finds best match in a search window.
 * Returns per-block displacement vectors with grid position metadata.
 */
function blockMatchingFlow(
  prev: Float32Array, curr: Float32Array,
  width: number, height: number,
  blockSize = 16, searchRadius = 8,
): { dx: number; dy: number; bx: number; by: number; blocksX: number; blocksY: number }[] {
  const vectors: { dx: number; dy: number; bx: number; by: number; blocksX: number; blocksY: number }[] = [];
  const blocksX = Math.floor(width / blockSize);
  const blocksY = Math.floor(height / blockSize);

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const refX = bx * blockSize;
      const refY = by * blockSize;

      let bestDx = 0, bestDy = 0;
      let bestSAD = Infinity;

      // Search window around the reference block
      for (let sy = -searchRadius; sy <= searchRadius; sy++) {
        for (let sx = -searchRadius; sx <= searchRadius; sx++) {
          const candX = refX + sx;
          const candY = refY + sy;

          // Bounds check
          if (candX < 0 || candY < 0 ||
              candX + blockSize > width || candY + blockSize > height) continue;

          // Sum of Absolute Differences
          let sad = 0;
          for (let py = 0; py < blockSize; py++) {
            const rowRef = (refY + py) * width + refX;
            const rowCand = (candY + py) * width + candX;
            for (let px = 0; px < blockSize; px++) {
              sad += Math.abs(prev[rowRef + px] - curr[rowCand + px]);
            }
          }

          if (sad < bestSAD) {
            bestSAD = sad;
            bestDx = sx;
            bestDy = sy;
          }
        }
      }

      vectors.push({ dx: bestDx, dy: bestDy, bx, by, blocksX, blocksY });
    }
  }

  return vectors;
}

/**
 * Compute optical flow between two frames and separate camera shake from object motion.
 * Camera motion = median displacement vector (robust to outliers from moving objects).
 * Object motion = residual after subtracting camera motion.
 */
function computeOpticalFlow(
  current: ImageData, previous: ImageData | null,
): FlowResult {
  if (!previous) return { totalMotion: 0, cameraShake: 0, objectMotion: 0 };

  const w = current.width;
  const h = current.height;
  const prevGray = toGrayscale(previous);
  const currGray = toGrayscale(current);

  const vectors = blockMatchingFlow(prevGray, currGray, w, h);

  if (vectors.length === 0) return { totalMotion: 0, cameraShake: 0, objectMotion: 0 };

  // Compute magnitudes
  const magnitudes = vectors.map(v => Math.sqrt(v.dx * v.dx + v.dy * v.dy));

  // Total motion: mean magnitude
  const totalMotion = magnitudes.reduce((s, m) => s + m, 0) / magnitudes.length;

  // Camera motion: median of dx and dy independently (robust to outliers)
  const dxSorted = vectors.map(v => v.dx).sort((a, b) => a - b);
  const dySorted = vectors.map(v => v.dy).sort((a, b) => a - b);
  const mid = Math.floor(vectors.length / 2);
  const medianDx = dxSorted[mid];
  const medianDy = dySorted[mid];
  const cameraShake = Math.sqrt(medianDx * medianDx + medianDy * medianDy);

  // Object motion: mean of residual magnitudes after removing camera motion
  const residuals = vectors.map(v => {
    const rx = v.dx - medianDx;
    const ry = v.dy - medianDy;
    return Math.sqrt(rx * rx + ry * ry);
  });
  const objectMotion = residuals.reduce((s, r) => s + r, 0) / residuals.length;

  return { totalMotion, cameraShake, objectMotion };
}

// ---------------------------------------------------------------------------
// Main QC engine
// ---------------------------------------------------------------------------

export async function runVideoQc(
  file: File,
  config: QcConfig = DEFAULT_QC_CONFIG,
  onProgress?: (p: QcProgress) => void,
): Promise<QcReport> {
  const report = (phase: QcProgress["phase"], current: number, total: number, message: string) => {
    onProgress?.({ phase, current, total, message });
  };

  report("init", 0, 1, "Carregando vídeo...");

  // 1. Load video metadata
  const videoUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Falha ao carregar vídeo"));
    video.src = videoUrl;
  });

  // Wait for video to be seekable
  await new Promise<void>((resolve) => {
    if (video.readyState >= 2) { resolve(); return; }
    video.oncanplay = () => resolve();
    video.load();
  });

  const duration = video.duration;
  const width = video.videoWidth;
  const height = video.videoHeight;
  const orientation: "landscape" | "portrait" | "square" =
    width > height ? "landscape" : width < height ? "portrait" : "square";
  const hasAudio = !!(video as any).mozHasAudio || !!(video as any).webkitAudioDecodedByteCount || !!(video as any).audioTracks?.length;

  // 2. Initialize MediaPipe
  report("init", 0, 1, "Carregando modelos MediaPipe...");

  const { HandLandmarker, FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm"
  );

  const handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "IMAGE",
    numHands: 2,
  });

  const faceMinConf = config.hardBlockRules.faceMinConfidence;

  const faceDetector = await FaceDetector.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
      delegate: "GPU",
    },
    runningMode: "IMAGE",
    minDetectionConfidence: faceMinConf,
  });

  // 3. Sample frames
  const canvas = document.createElement("canvas");
  // Use smaller resolution for analysis to save memory
  const analysisScale = Math.min(1, 640 / Math.max(width, height));
  canvas.width = Math.round(width * analysisScale);
  canvas.height = Math.round(height * analysisScale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  const interval = 1 / config.fps;
  const totalFrames = Math.floor(duration * config.fps);
  const frames: FrameAnalysis[] = [];
  let prevImageData: ImageData | null = null;

  report("sampling", 0, totalFrames, "Extraindo frames...");

  for (let i = 0; i < totalFrames; i++) {
    const time = i * interval;

    // Seek to time
    await new Promise<void>((resolve) => {
      const onSeeked = () => { video.removeEventListener("seeked", onSeeked); resolve(); };
      video.addEventListener("seeked", onSeeked);
      video.currentTime = time;
    });

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    report("analyzing", i, totalFrames, `Analisando frame ${i + 1}/${totalFrames}...`);

    // MediaPipe Hand Detection
    let handsDetected = 0;
    let handConfidence = 0;
    const handBboxes: FrameAnalysis["handBboxes"] = [];

    try {
      const handResult = handLandmarker.detect(canvas);
      handsDetected = handResult.handednesses?.length || 0;

      if (handResult.handednesses) {
        for (const h of handResult.handednesses) {
          handConfidence = Math.max(handConfidence, h[0]?.score || 0);
        }
      }

      if (handResult.landmarks) {
        for (const landmarks of handResult.landmarks) {
          let minX = 1, minY = 1, maxX = 0, maxY = 0;
          for (const pt of landmarks) {
            minX = Math.min(minX, pt.x);
            minY = Math.min(minY, pt.y);
            maxX = Math.max(maxX, pt.x);
            maxY = Math.max(maxY, pt.y);
          }
          handBboxes.push({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
        }
      }
    } catch (e) {
      console.warn("[QC] Hand detection error on frame", i, e);
    }

    // MediaPipe Face Detection
    let faceDetected = false;
    let faceConfidence = 0;

    try {
      const faceResult = faceDetector.detect(canvas);
      if (faceResult.detections && faceResult.detections.length > 0) {
        faceDetected = true;
        faceConfidence = faceResult.detections[0].categories?.[0]?.score || 0;
      }
    } catch (e) {
      console.warn("[QC] Face detection error on frame", i, e);
    }

    // Blur
    const blurScore = computeBlurScore(imageData, analysisScale);

    // Lighting
    const { brightness, contrast } = computeLighting(imageData);

    // Motion / Optical Flow
    const flow = computeOpticalFlow(imageData, prevImageData);
    prevImageData = imageData;

    frames.push({
      time,
      handsDetected,
      handConfidence,
      handBboxes,
      faceDetected,
      faceConfidence,
      blurScore,
      brightness,
      contrast,
      motionDelta: flow.totalMotion,
      cameraShake: flow.cameraShake,
      objectMotion: flow.objectMotion,
    });
  }

  // Cleanup
  handLandmarker.close();
  faceDetector.close();
  URL.revokeObjectURL(videoUrl);

  // 4. Compute aggregate metrics
  report("scoring", 0, 1, "Calculando score...");

  const n = frames.length || 1;

  // Hand metrics
  const framesWithHands = frames.filter(f => f.handsDetected > 0).length;
  const handPresenceRate = framesWithHands / n;
  const dualHandRate = frames.filter(f => f.handsDetected >= 2).length / n;

  // Hand centering (how centered are hands in the frame)
  let centeringSum = 0;
  let sizeSum = 0;
  let centerCount = 0;
  for (const f of frames) {
    for (const bbox of f.handBboxes) {
      const cx = bbox.x + bbox.w / 2;
      const cy = bbox.y + bbox.h / 2;
      const distFromCenter = Math.sqrt((cx - 0.5) ** 2 + (cy - 0.5) ** 2);
      centeringSum += 1 - Math.min(1, distFromCenter * 2);
      sizeSum += bbox.w * bbox.h;
      centerCount++;
    }
  }
  const handCenteringScore = centerCount > 0 ? (centeringSum / centerCount) * 100 : 0;
  const handSizeScore = centerCount > 0 ? Math.min(100, (sizeSum / centerCount) * 400) : 0;

  // Tracking continuity
  let trackingGaps = 0;
  let inGap = false;
  for (const f of frames) {
    if (f.handsDetected === 0) {
      if (!inGap) { trackingGaps++; inGap = true; }
    } else {
      inGap = false;
    }
  }
  const trackingContinuityScore = Math.max(0, 100 - trackingGaps * 10);

  // Face metrics
  const facePresenceRate = frames.filter(f => f.faceDetected).length / n;
  let maxFaceDuration = 0;
  let currentFaceRun = 0;
  for (const f of frames) {
    if (f.faceDetected) {
      currentFaceRun += interval;
      maxFaceDuration = Math.max(maxFaceDuration, currentFaceRun);
    } else {
      currentFaceRun = 0;
    }
  }

  // Quality metrics
  const avgBlur = frames.reduce((s, f) => s + f.blurScore, 0) / n;
  const avgBrightness = frames.reduce((s, f) => s + f.brightness, 0) / n;

  // Optical flow: stability based on camera shake only (ignores intentional object motion)
  const motionFrames = frames.slice(1);
  const avgCameraShake = motionFrames.length > 0
    ? motionFrames.reduce((s, f) => s + f.cameraShake, 0) / motionFrames.length
    : 0;

  // Normalize to 0-100 scores
  const blurScoreNorm = Math.min(100, avgBlur);
  const brightnessScore = avgBrightness < 40 ? (avgBrightness / 40) * 100
    : avgBrightness > 220 ? ((255 - avgBrightness) / 35) * 100
    : 100;
  // Camera shake of ~4px+ per frame = very unstable
  const stabilityScore = Math.max(0, 100 - avgCameraShake * 25);

  // 5. Compute final score
  const w = config.weights;
  const durationOk = duration >= config.minDurationSec && duration <= config.maxDurationSec;
  const durationScore = durationOk ? 100 : duration < config.minDurationSec ? (duration / config.minDurationSec) * 100 : 50;
  const faceAbsenceScore = (1 - facePresenceRate) * 100;

  const qcScore = Math.round(
    handPresenceRate * 100 * w.handPresence +
    faceAbsenceScore * w.faceAbsence +
    durationScore * w.durationCompliance +
    handCenteringScore * w.framing +
    blurScoreNorm * w.blur +
    brightnessScore * w.lighting +
    stabilityScore * w.stability
  );

  // 6. Classification
  const failureReasons: string[] = [];
  const warningReasons: string[] = [];

  // Hard blocks
  if (duration < config.hardBlockRules.minDurationSec) {
    failureReasons.push(`Duração muito curta: ${duration.toFixed(1)}s (mín: ${config.hardBlockRules.minDurationSec}s)`);
  }
  if (config.requiredOrientation !== "any" && orientation !== config.requiredOrientation) {
    failureReasons.push(`Orientação incorreta: ${orientation} (requerido: ${config.requiredOrientation})`);
  }
  if (facePresenceRate > config.hardBlockRules.maxFacePresenceRate) {
    failureReasons.push(`Rosto detectado em ${(facePresenceRate * 100).toFixed(0)}% dos frames (máx: ${(config.hardBlockRules.maxFacePresenceRate * 100).toFixed(0)}%)`);
  }
  if (handPresenceRate < config.hardBlockRules.minHandPresenceRate) {
    failureReasons.push(`Mãos detectadas em apenas ${(handPresenceRate * 100).toFixed(0)}% dos frames (mín: ${(config.hardBlockRules.minHandPresenceRate * 100).toFixed(0)}%)`);
  }

  // Warnings
  if (avgBrightness < 50) warningReasons.push(`Iluminação baixa: ${avgBrightness.toFixed(0)}/255`);
  if (avgBlur < 30) warningReasons.push(`Vídeo com blur: score ${avgBlur.toFixed(0)}/100`);
  if (stabilityScore < 50) warningReasons.push(`Vídeo instável: score ${stabilityScore.toFixed(0)}/100`);
  if (handCenteringScore < 40) warningReasons.push(`Enquadramento fraco: score ${handCenteringScore.toFixed(0)}/100`);

  let qcStatus: QcReport["qcStatus"];
  if (failureReasons.length > 0) {
    qcStatus = "BLOCK";
  } else if (qcScore >= config.thresholds.pass) {
    qcStatus = "PASS";
  } else if (qcScore >= config.thresholds.warning) {
    qcStatus = "WARNING";
  } else {
    qcStatus = "BLOCK";
  }

  report("done", 1, 1, "Análise concluída");

  return {
    duration,
    width,
    height,
    fps: config.fps,
    orientation,
    hasAudio,
    fileSize: file.size,
    integrityPassed: true,
    handPresenceRate,
    dualHandRate,
    handCenteringScore,
    handSizeScore,
    trackingContinuityScore,
    facePresenceRate,
    maxFaceDuration,
    blurScore: blurScoreNorm,
    brightnessScore,
    stabilityScore,
    qcScore: Math.max(0, Math.min(100, qcScore)),
    qcStatus,
    failureReasons,
    warningReasons,
    frames,
    analyzedFrames: n,
    totalFrames: Math.round(duration * (video.getVideoPlaybackQuality?.()?.totalVideoFrames || 30) / duration) || totalFrames,
  };
}
