import { useState, useEffect, useRef, useCallback } from "react";
import { AlertTriangle, Activity, Volume2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface ClippingRegion {
  start: number; // percentage 0-100
  end: number;   // percentage 0-100
  severity: 'warning' | 'critical';
}

interface WaveformData {
  peaks: number[];
  clippingRegions: ClippingRegion[];
  peakLevel: number; // 0-1
  clippingPercentage: number;
}

interface WaveformVisualizerProps {
  audioUrl: string | null;
  snrDb: number | null;
  className?: string;
}

export function WaveformVisualizer({ audioUrl, snrDb, className = "" }: WaveformVisualizerProps) {
  const [waveformData, setWaveformData] = useState<WaveformData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const analyzeAudio = useCallback(async (url: string) => {
    setIsLoading(true);
    setError(null);

    try {
      // Try to fetch the audio file
      const response = await fetch(url, { 
        mode: 'cors',
        credentials: 'omit'
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      
      // Create offline context for analysis
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const channelData = audioBuffer.getChannelData(0);
      
      await audioContext.close();
      
      const numBars = 200;
      const samplesPerBar = Math.floor(channelData.length / numBars);
      
      const peaks: number[] = [];
      const clippingRegions: ClippingRegion[] = [];
      let currentClipStart: number | null = null;
      let totalClippingSamples = 0;
      let maxPeak = 0;
      
      const warningThreshold = 0.9;
      const criticalThreshold = 0.98;
      
      for (let i = 0; i < numBars; i++) {
        const start = i * samplesPerBar;
        const end = Math.min(start + samplesPerBar, channelData.length);
        
        let barMax = 0;
        let barClipCount = 0;
        
        for (let j = start; j < end; j++) {
          const sample = Math.abs(channelData[j]);
          if (sample > barMax) barMax = sample;
          if (sample >= criticalThreshold) barClipCount++;
        }
        
        peaks.push(barMax);
        if (barMax > maxPeak) maxPeak = barMax;
        
        const isClipping = barMax >= warningThreshold;
        const percentPos = (i / numBars) * 100;
        
        if (isClipping) {
          totalClippingSamples += barClipCount;
          if (currentClipStart === null) {
            currentClipStart = percentPos;
          }
        } else if (currentClipStart !== null) {
          clippingRegions.push({
            start: currentClipStart,
            end: percentPos,
            severity: peaks.slice(
              Math.floor(currentClipStart / 100 * numBars),
              i
            ).some(p => p >= criticalThreshold) ? 'critical' : 'warning'
          });
          currentClipStart = null;
        }
      }
      
      if (currentClipStart !== null) {
        clippingRegions.push({
          start: currentClipStart,
          end: 100,
          severity: 'critical'
        });
      }
      
      const clippingPercentage = (totalClippingSamples / channelData.length) * 100;
      
      setWaveformData({
        peaks,
        clippingRegions,
        peakLevel: maxPeak,
        clippingPercentage
      });
    } catch (err) {
      console.error("Audio analysis unavailable (CORS):", err);
      // Set null data - we'll show SNR-only view
      setWaveformData(null);
      // Don't set error - just silently fall back to SNR display
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Analyze audio when URL changes
  useEffect(() => {
    if (audioUrl) {
      analyzeAudio(audioUrl);
    } else {
      setWaveformData(null);
    }
  }, [audioUrl, analyzeAudio]);

  // Draw waveform on canvas
  useEffect(() => {
    if (!waveformData || !canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size based on container
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const { peaks, clippingRegions } = waveformData;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw clipping region highlights
    for (const region of clippingRegions) {
      const startX = (region.start / 100) * width;
      const endX = (region.end / 100) * width;
      
      ctx.fillStyle = region.severity === 'critical' 
        ? 'rgba(239, 68, 68, 0.2)'  // red
        : 'rgba(234, 179, 8, 0.15)'; // yellow
      ctx.fillRect(startX, 0, endX - startX, height);
    }

    // Draw waveform bars
    const barWidth = width / peaks.length;
    const midY = height / 2;

    for (let i = 0; i < peaks.length; i++) {
      const peak = peaks[i];
      const barHeight = peak * (height * 0.9);
      const x = i * barWidth;

      // Determine bar color based on peak level
      let color: string;
      if (peak >= 0.98) {
        color = 'rgb(239, 68, 68)'; // red - critical clipping
      } else if (peak >= 0.9) {
        color = 'rgb(234, 179, 8)'; // yellow - warning
      } else if (peak >= 0.7) {
        color = 'rgb(34, 197, 94)'; // green - good level
      } else {
        color = 'hsl(var(--primary))'; // primary color - normal
      }

      ctx.fillStyle = color;
      
      // Draw mirrored bar (top and bottom)
      ctx.fillRect(
        x + 0.5,
        midY - barHeight / 2,
        Math.max(barWidth - 1, 1),
        barHeight
      );
    }

    // Draw center line
    ctx.strokeStyle = 'hsl(var(--muted-foreground) / 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    // Draw threshold lines
    const warningY = height * 0.05;
    ctx.strokeStyle = 'rgba(234, 179, 8, 0.5)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, warningY);
    ctx.lineTo(width, warningY);
    ctx.moveTo(0, height - warningY);
    ctx.lineTo(width, height - warningY);
    ctx.stroke();
    ctx.setLineDash([]);

  }, [waveformData]);

  if (!audioUrl) {
    return null;
  }

  if (isLoading) {
    return (
      <div className={`space-y-2 ${className}`}>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Activity className="h-3 w-3 animate-pulse" />
          <span>Analyzing audio...</span>
        </div>
        <Skeleton className="h-16 w-full rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`text-xs text-muted-foreground ${className}`}>
        {error}
      </div>
    );
  }

  // Fallback: show SNR-only view when waveform data couldn't be loaded (CORS)
  if (!waveformData && !isLoading && snrDb !== null) {
    return (
      <div className={`space-y-2 ${className}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge 
            variant="outline" 
            className={`text-xs ${
              snrDb >= 20 
                ? 'bg-green-500/10 text-green-400 border-green-500/30' 
                : snrDb >= 10 
                  ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30'
                  : 'bg-red-500/10 text-red-400 border-red-500/30'
            }`}
          >
            SNR {snrDb}dB {snrDb >= 20 ? '✓ Good quality' : snrDb >= 10 ? '⚠ Fair quality' : '✗ Poor quality'}
          </Badge>
        </div>
        <div className="text-[10px] text-muted-foreground/60">
          Waveform analysis unavailable (external storage)
        </div>
      </div>
    );
  }

  if (!waveformData) return null;

  const hasClipping = waveformData.clippingRegions.length > 0;
  const hasCriticalClipping = waveformData.clippingRegions.some(r => r.severity === 'critical');

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Waveform info badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Volume2 className="h-3 w-3" />
          <span>Peak: {Math.round(waveformData.peakLevel * 100)}%</span>
        </div>
        
        {snrDb !== null && (
          <Badge 
            variant="outline" 
            className={`text-xs ${
              snrDb >= 20 
                ? 'bg-green-500/10 text-green-400 border-green-500/30' 
                : snrDb >= 10 
                  ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30'
                  : 'bg-red-500/10 text-red-400 border-red-500/30'
            }`}
          >
            SNR {snrDb}dB
          </Badge>
        )}

        {hasClipping && (
          <Badge 
            variant="outline"
            className={`text-xs flex items-center gap-1 ${
              hasCriticalClipping 
                ? 'bg-red-500/10 text-red-400 border-red-500/30' 
                : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30'
            }`}
          >
            <AlertTriangle className="h-3 w-3" />
            {hasCriticalClipping ? 'Clipping detected' : 'Near clipping'}
            {waveformData.clippingPercentage > 0.01 && (
              <span>({waveformData.clippingPercentage.toFixed(2)}%)</span>
            )}
          </Badge>
        )}
      </div>

      {/* Waveform canvas */}
      <div 
        ref={containerRef}
        className="relative h-16 w-full bg-muted/30 rounded-lg overflow-hidden"
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
        />
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-primary" />
          <span>Normal</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span>Good level</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-yellow-500" />
          <span>Warning</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <span>Clipping</span>
        </div>
      </div>
    </div>
  );
}