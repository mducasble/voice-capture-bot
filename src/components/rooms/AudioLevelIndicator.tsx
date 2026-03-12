import { useEffect, useRef, useState } from "react";

interface AudioLevelIndicatorProps {
  stream: MediaStream | null;
  isConnected: boolean;
  status?: "connecting" | "connected" | "reconnecting" | "failed";
  /** Compact mode for mobile */
  compact?: boolean;
}

export function AudioLevelIndicator({ stream, isConnected, status, compact = false }: AudioLevelIndicatorProps) {
  const [levels, setLevels] = useState([0, 0, 0]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!stream || (status !== "connected" && status !== undefined)) {
      setLevels([0, 0, 0]);
      return;
    }

    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.3;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(dataArray);
        // Split frequency bands into 3 groups (low, mid, high)
        const third = Math.floor(dataArray.length / 3);
        const low = average(dataArray, 0, third);
        const mid = average(dataArray, third, third * 2);
        const high = average(dataArray, third * 2, dataArray.length);
        setLevels([low, mid, high]);
        animFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // Audio context creation can fail
    }

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      if (audioCtxRef.current?.state !== "closed") {
        audioCtxRef.current?.close().catch(() => {});
      }
    };
  }, [stream, status]);

  const isOnline = isConnected && (status === "connected" || !status);
  const isActive = levels.some(l => l > 0.05);
  const statusText = !isConnected
    ? "Offline"
    : status === "connecting"
      ? "Conectando..."
      : status === "reconnecting"
        ? "Reconectando..."
        : "Online";

  const statusColor = !isConnected
    ? "var(--portal-text-muted, #666)"
    : status === "connecting" || status === "reconnecting"
      ? "#f59e0b"
      : "hsl(142 71% 45%)";

  if (compact) {
    return (
      <div className="flex items-center gap-1">
        <span
        className="font-mono text-[10px] uppercase tracking-wider"
          style={{ color: statusColor }}
        >
          {statusText}
        </span>
        {isOnline && (
          <div className="flex items-end gap-[2px] h-[14px]">
            {levels.map((level, i) => (
              <div
                key={i}
                className="w-[3px] rounded-full transition-all duration-75"
                style={{
                  height: `${Math.max(3, Math.min(1, level * 3) * 14)}px`,
                  backgroundColor: isActive ? "hsl(142 71% 45%)" : "var(--portal-text-muted, #555)",
                  opacity: isActive ? 1 : 0.4,
                }}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <span
        className="font-mono text-[11px] uppercase tracking-wider font-medium"
        style={{ color: statusColor }}
      >
        {statusText}
      </span>
      {isOnline && (
        <div className="flex items-end gap-[2px] h-[16px]">
          {levels.map((level, i) => (
            <div
              key={i}
              className="w-[3.5px] rounded-full transition-all duration-75"
              style={{
                height: `${Math.max(4, Math.min(1, level * 3) * 16)}px`,
                backgroundColor: isActive ? "hsl(142 71% 45%)" : "var(--portal-text-muted, #555)",
                opacity: isActive ? 1 : 0.3,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function average(arr: Uint8Array, start: number, end: number): number {
  let sum = 0;
  const len = end - start;
  if (len <= 0) return 0;
  for (let i = start; i < end; i++) {
    sum += arr[i];
  }
  return sum / len / 255; // Normalize to 0-1
}
