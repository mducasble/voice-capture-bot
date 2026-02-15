import { useRef, useEffect, useState, useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface ReviewWaveformProps {
  audioUrl: string;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
}

export function ReviewWaveform({ audioUrl, currentTime, duration, onSeek }: ReviewWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Analyze audio to extract peaks
  useEffect(() => {
    if (!audioUrl) return;
    setIsLoading(true);

    (async () => {
      try {
        const response = await fetch(audioUrl, { mode: "cors", credentials: "omit" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        const ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(buffer);
        const channelData = decoded.getChannelData(0);
        await ctx.close();

        const numBars = 300;
        const samplesPerBar = Math.floor(channelData.length / numBars);
        const p: number[] = [];
        for (let i = 0; i < numBars; i++) {
          let max = 0;
          const start = i * samplesPerBar;
          const end = Math.min(start + samplesPerBar, channelData.length);
          for (let j = start; j < end; j++) {
            const abs = Math.abs(channelData[j]);
            if (abs > max) max = abs;
          }
          p.push(max);
        }
        setPeaks(p);
      } catch (err) {
        console.error("Waveform analysis failed:", err);
        setPeaks(null);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [audioUrl]);

  // Draw waveform
  useEffect(() => {
    if (!peaks || !canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const barWidth = width / peaks.length;
    const midY = height / 2;
    const progress = duration > 0 ? currentTime / duration : 0;
    const playedBarIndex = Math.floor(progress * peaks.length);

    ctx.clearRect(0, 0, width, height);

    // Draw center line
    ctx.strokeStyle = "hsl(var(--muted-foreground) / 0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    // Draw bars
    for (let i = 0; i < peaks.length; i++) {
      const barHeight = peaks[i] * (height * 0.85);
      const x = i * barWidth;
      const isPlayed = i <= playedBarIndex;

      ctx.fillStyle = isPlayed
        ? "hsl(var(--primary))"
        : "hsl(var(--primary) / 0.3)";
      ctx.fillRect(x + 0.5, midY - barHeight / 2, Math.max(barWidth - 1, 1), barHeight);
    }

    // Draw playhead
    if (progress > 0) {
      const playheadX = progress * width;
      ctx.strokeStyle = "hsl(var(--primary))";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();
    }
  }, [peaks, currentTime, duration]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current || duration <= 0) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      onSeek(pct * duration);
    },
    [duration, onSeek]
  );

  if (isLoading) {
    return <Skeleton className="h-20 w-full rounded-lg" />;
  }

  if (!peaks) {
    return <div className="h-20 w-full rounded-lg bg-muted/30 flex items-center justify-center text-xs text-muted-foreground">Waveform indisponível</div>;
  }

  return (
    <div
      ref={containerRef}
      className="relative h-20 w-full bg-muted/20 rounded-lg overflow-hidden cursor-pointer hover:bg-muted/30 transition-colors"
      onClick={handleClick}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}
