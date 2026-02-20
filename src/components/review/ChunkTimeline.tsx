import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { type TimedWord, type WordTag, WORD_TAG_LABELS } from "@/lib/reviewTypes";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ZoomIn } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { WaveformZoomDialog } from "./WaveformZoomDialog";

const CHUNK_DURATION = 30;

function formatTimestamp(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 100);
  return `${m}:${sec.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}

interface ChunkTimelineProps {
  words: TimedWord[];
  currentTime: number;
  duration: number;
  audioUrl: string;
  onSeek: (time: number) => void;
  onWordsChange: (words: TimedWord[]) => void;
  isPlaying: boolean;
}

export function ChunkTimeline({
  words,
  currentTime,
  duration,
  audioUrl,
  onSeek,
  onWordsChange,
  isPlaying,
}: ChunkTimelineProps) {
  const totalChunks = Math.max(1, Math.ceil(duration / CHUNK_DURATION));
  const [currentChunk, setCurrentChunk] = useState(0);
  const [allPeaks, setAllPeaks] = useState<number[] | null>(null);
  const [tagMenuIndex, setTagMenuIndex] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoomRange, setZoomRange] = useState<{ start: number; end: number }>({ start: 0, end: 5 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeWordRef = useRef<HTMLSpanElement>(null);

  // Auto-advance chunk
  useEffect(() => {
    if (isPlaying && duration > 0) {
      const chunk = Math.floor(currentTime / CHUNK_DURATION);
      if (chunk !== currentChunk && chunk < totalChunks) {
        setCurrentChunk(chunk);
      }
    }
  }, [currentTime, isPlaying, currentChunk, totalChunks, duration]);

  const chunkStart = currentChunk * CHUNK_DURATION;
  const chunkEnd = Math.min(chunkStart + CHUNK_DURATION, duration);

  // Words in current chunk
  const chunkWords = useMemo(() => {
    return words
      .map((w, i) => ({ ...w, globalIndex: i }))
      .filter((w) => w.start >= chunkStart && w.start < chunkEnd);
  }, [words, chunkStart, chunkEnd]);

  // Active word index (karaoke)
  const activeWordGlobalIndex = useMemo(() => {
    for (let i = chunkWords.length - 1; i >= 0; i--) {
      if (currentTime >= chunkWords[i].start && currentTime < chunkWords[i].end) {
        return chunkWords[i].globalIndex;
      }
    }
    // If between words, highlight the last one that started
    for (let i = chunkWords.length - 1; i >= 0; i--) {
      if (currentTime >= chunkWords[i].start) return chunkWords[i].globalIndex;
    }
    return -1;
  }, [chunkWords, currentTime]);

  // Auto-scroll to active word
  useEffect(() => {
    if (isPlaying && activeWordRef.current) {
      activeWordRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeWordGlobalIndex, isPlaying]);

  // Analyze full audio peaks
  useEffect(() => {
    if (!audioUrl) return;
    (async () => {
      try {
        const response = await fetch(audioUrl, { mode: "cors", credentials: "omit" });
        if (!response.ok) return;
        const buffer = await response.arrayBuffer();
        const ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(buffer);
        const channelData = decoded.getChannelData(0);
        await ctx.close();

        const peaksPerSecond = 100;
        const totalPeaks = Math.ceil(decoded.duration * peaksPerSecond);
        const samplesPerPeak = Math.floor(channelData.length / totalPeaks);
        const p: number[] = [];
        for (let i = 0; i < totalPeaks; i++) {
          let max = 0;
          const start = i * samplesPerPeak;
          const end = Math.min(start + samplesPerPeak, channelData.length);
          for (let j = start; j < end; j++) {
            const abs = Math.abs(channelData[j]);
            if (abs > max) max = abs;
          }
          p.push(max);
        }
        setAllPeaks(p);
      } catch (err) {
        console.error("ChunkTimeline: waveform analysis failed", err);
      }
    })();
  }, [audioUrl]);

  // Draw chunk waveform
  useEffect(() => {
    if (!allPeaks || !canvasRef.current || !containerRef.current) return;
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
    const midY = height / 2;

    const peaksPerSecond = 100;
    const startPeak = Math.floor(chunkStart * peaksPerSecond);
    const endPeak = Math.min(Math.ceil(chunkEnd * peaksPerSecond), allPeaks.length);
    const chunkPeaks = allPeaks.slice(startPeak, endPeak);
    if (chunkPeaks.length === 0) return;

    const barWidth = width / chunkPeaks.length;
    const playProgress = duration > 0 ? (currentTime - chunkStart) / CHUNK_DURATION : 0;
    const playedBarIndex = Math.floor(Math.max(0, playProgress) * chunkPeaks.length);

    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = "hsl(var(--muted-foreground) / 0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    for (let i = 0; i < chunkPeaks.length; i++) {
      const barHeight = chunkPeaks[i] * (height * 0.85);
      const x = i * barWidth;
      const isPlayed = currentTime >= chunkStart && i <= playedBarIndex;
      ctx.fillStyle = isPlayed
        ? "hsl(var(--primary))"
        : "hsl(var(--primary) / 0.25)";
      ctx.fillRect(x + 0.5, midY - barHeight / 2, Math.max(barWidth - 1, 1), barHeight);
    }

    if (currentTime >= chunkStart && currentTime <= chunkEnd) {
      const playheadX = ((currentTime - chunkStart) / CHUNK_DURATION) * width;
      ctx.strokeStyle = "hsl(var(--primary))";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();
    }
  }, [allPeaks, currentTime, chunkStart, chunkEnd, duration]);

  const handleWaveformClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current || duration <= 0) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      const clickTime = chunkStart + pct * CHUNK_DURATION;

      // Open zoom dialog centered around click point
      const ZOOM_WINDOW = 5;
      const half = ZOOM_WINDOW / 2;
      let zStart = clickTime - half;
      let zEnd = clickTime + half;
      if (zStart < chunkStart) { zStart = chunkStart; zEnd = chunkStart + ZOOM_WINDOW; }
      if (zEnd > chunkEnd) { zEnd = chunkEnd; zStart = Math.max(chunkStart, chunkEnd - ZOOM_WINDOW); }
      setZoomRange({ start: zStart, end: zEnd });
      setZoomOpen(true);
    },
    [chunkStart, chunkEnd, duration]
  );

  const handleWaveformHover = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      setHoverPct(Math.max(0, Math.min(1, pct)));
    },
    []
  );

  const commitEdit = useCallback(() => {
    if (editingIndex === null) return;
    const updated = [...words];
    const original = updated[editingIndex].text;
    const newText = editValue.trim();
    if (newText && newText !== original) {
      updated[editingIndex] = { ...updated[editingIndex], editedText: newText };
    } else {
      const { editedText: _, ...rest } = updated[editingIndex];
      updated[editingIndex] = rest;
    }
    onWordsChange(updated);
    setEditingIndex(null);
  }, [editingIndex, editValue, words, onWordsChange]);

  const applyTag = useCallback(
    (index: number, tag: WordTag | null) => {
      const updated = [...words];
      if (tag) {
        updated[index] = { ...updated[index], tag };
      } else {
        const { tag: _, ...rest } = updated[index];
        updated[index] = rest;
      }
      onWordsChange(updated);
      setTagMenuIndex(null);
    },
    [words, onWordsChange]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Chunk navigation */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setCurrentChunk(Math.max(0, currentChunk - 1));
            onSeek(Math.max(0, currentChunk - 1) * CHUNK_DURATION);
          }}
          disabled={currentChunk === 0}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Anterior
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums font-mono">
          Bloco {currentChunk + 1} / {totalChunks} — {formatTimestamp(chunkStart)} →{" "}
          {formatTimestamp(chunkEnd)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setCurrentChunk(Math.min(totalChunks - 1, currentChunk + 1));
            onSeek(Math.min(totalChunks - 1, currentChunk + 1) * CHUNK_DURATION);
          }}
          disabled={currentChunk >= totalChunks - 1}
        >
          Próximo
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>

      {/* Waveform */}
      <div
        ref={containerRef}
        className="relative h-24 mx-4 mt-3 bg-muted/20 rounded-lg overflow-hidden cursor-zoom-in transition-colors shrink-0"
        onClick={handleWaveformClick}
        onMouseMove={handleWaveformHover}
        onMouseLeave={() => setHoverPct(null)}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />

        {/* Hover zoom indicator */}
        {hoverPct !== null && (
          <>
            {/* Highlight box (~5s window) */}
            {(() => {
              const windowPct = Math.min(5 / CHUNK_DURATION, 1);
              const halfW = windowPct / 2;
              const left = Math.max(0, Math.min(1 - windowPct, hoverPct - halfW));
              return (
                <div
                  className="absolute top-0 bottom-0 bg-primary/10 border border-primary/30 rounded pointer-events-none transition-[left] duration-75"
                  style={{ left: `${left * 100}%`, width: `${windowPct * 100}%` }}
                >
                  <div className="absolute top-1 right-1">
                    <ZoomIn className="h-3.5 w-3.5 text-primary/60" />
                  </div>
                </div>
              );
            })()}
          </>
        )}

        <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2 pb-0.5">
          {[0, 5, 10, 15, 20, 25, 30].map((sec) => {
            const t = chunkStart + sec;
            if (t > duration) return null;
            return (
              <span key={sec} className="text-[9px] text-muted-foreground/50 tabular-nums font-mono">
                {formatTimestamp(t)}
              </span>
            );
          })}
        </div>
      </div>

      {/* Karaoke text - flowing inline words */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="flex flex-wrap gap-x-1 gap-y-1 leading-relaxed">
          {chunkWords.map((word) => {
            const idx = word.globalIndex;
            const isActive = idx === activeWordGlobalIndex;
            const isPast = currentTime > word.end;
            const hasEdit = !!word.editedText;
            const hasTag = !!word.tag;

            if (editingIndex === idx) {
              return (
                <input
                  key={idx}
                  className="text-sm w-20 h-6 px-1 bg-background border border-border rounded"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") setEditingIndex(null);
                  }}
                  autoFocus
                />
              );
            }

            return (
              <Popover
                key={idx}
                open={tagMenuIndex === idx}
                onOpenChange={(open) => setTagMenuIndex(open ? idx : null)}
              >
                <PopoverTrigger asChild>
                  <span
                    ref={isActive ? activeWordRef : undefined}
                    className={cn(
                      "text-sm px-1 py-0.5 rounded cursor-pointer select-none transition-all duration-150",
                      isActive &&
                        "bg-primary/25 text-foreground font-semibold scale-105 shadow-sm shadow-primary/20",
                      isPast && !isActive && "text-foreground/80",
                      !isPast && !isActive && "text-muted-foreground/50",
                      hasEdit &&
                        "underline decoration-primary decoration-2 underline-offset-4",
                      hasTag && "border-b-2 border-dashed border-destructive",
                      "hover:bg-muted/40"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSeek(word.start);
                    }}
                    onDoubleClick={() => {
                      setEditingIndex(idx);
                      setEditValue(word.editedText ?? word.text);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setTagMenuIndex(idx);
                    }}
                  >
                    {word.editedText ?? word.text}
                    {hasTag && (
                      <span className="ml-0.5 text-[10px]">
                        {WORD_TAG_LABELS[word.tag!].emoji}
                      </span>
                    )}
                  </span>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-2 flex flex-col gap-1" side="top" align="center">
                  <p className="text-xs text-muted-foreground mb-1 px-1">Marcar como:</p>
                  {(Object.entries(WORD_TAG_LABELS) as [WordTag, { label: string; emoji: string }][]).map(
                    ([tag, { label, emoji }]) => (
                      <Button
                        key={tag}
                        variant={word.tag === tag ? "default" : "ghost"}
                        size="sm"
                        className="justify-start text-xs h-7"
                        onClick={() => applyTag(idx, word.tag === tag ? null : tag)}
                      >
                        {emoji} {label}
                      </Button>
                    )
                  )}
                  {hasEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="justify-start text-xs h-7 text-destructive"
                      onClick={() => {
                        const updated = [...words];
                        const { editedText: _, ...rest } = updated[idx];
                        updated[idx] = rest;
                        onWordsChange(updated);
                        setTagMenuIndex(null);
                      }}
                    >
                      ↩ Restaurar original
                    </Button>
                  )}
                </PopoverContent>
              </Popover>
            );
          })}
        </div>
      </div>

      {/* Zoom dialog */}
      {allPeaks && (
        <WaveformZoomDialog
          open={zoomOpen}
          onOpenChange={setZoomOpen}
          zoomStart={zoomRange.start}
          zoomEnd={zoomRange.end}
          allPeaks={allPeaks}
          words={words}
          onWordsChange={onWordsChange}
          onSeek={onSeek}
          audioUrl={audioUrl}
        />
      )}
    </div>
  );
}
