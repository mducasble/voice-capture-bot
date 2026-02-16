import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { type TimedWord, type WordTag, WORD_TAG_LABELS } from "@/lib/reviewTypes";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const CHUNK_DURATION = 30; // seconds per chunk

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

interface ChunkPeaks {
  chunkIndex: number;
  peaks: number[];
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const dragStartX = useRef(0);
  const dragStartTime = useRef(0);

  // Auto-advance chunk based on playback
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

        // ~100 peaks per second for fine-grained display
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

    // Extract peaks for this chunk
    const peaksPerSecond = 100;
    const startPeak = Math.floor(chunkStart * peaksPerSecond);
    const endPeak = Math.min(Math.ceil(chunkEnd * peaksPerSecond), allPeaks.length);
    const chunkPeaks = allPeaks.slice(startPeak, endPeak);

    if (chunkPeaks.length === 0) return;

    const barWidth = width / chunkPeaks.length;
    const playProgress = duration > 0 ? (currentTime - chunkStart) / CHUNK_DURATION : 0;
    const playedBarIndex = Math.floor(Math.max(0, playProgress) * chunkPeaks.length);

    ctx.clearRect(0, 0, width, height);

    // Center line
    ctx.strokeStyle = "hsl(var(--muted-foreground) / 0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    // Bars
    for (let i = 0; i < chunkPeaks.length; i++) {
      const barHeight = chunkPeaks[i] * (height * 0.85);
      const x = i * barWidth;
      const isPlayed = currentTime >= chunkStart && i <= playedBarIndex;

      ctx.fillStyle = isPlayed
        ? "hsl(var(--primary))"
        : "hsl(var(--primary) / 0.25)";
      ctx.fillRect(x + 0.5, midY - barHeight / 2, Math.max(barWidth - 1, 1), barHeight);
    }

    // Playhead
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

  // Click on waveform to seek
  const handleWaveformClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current || duration <= 0) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      onSeek(chunkStart + pct * CHUNK_DURATION);
    },
    [chunkStart, duration, onSeek]
  );

  // Stagger words vertically to prevent overlap
  const wordPositions = useMemo(() => {
    if (!timelineRef.current) return chunkWords.map(() => ({ left: 0, row: 0 }));
    const containerWidth = timelineRef.current?.getBoundingClientRect().width || 800;
    
    const positions: { left: number; row: number }[] = [];
    const rowEnds: number[] = []; // tracks the right edge of last word in each row

    for (const word of chunkWords) {
      const leftPct = (word.start - chunkStart) / CHUNK_DURATION;
      const leftPx = leftPct * containerWidth;
      const estimatedWidth = (word.editedText ?? word.text).length * 9 + 16;

      // Find first row where this word doesn't overlap
      let row = 0;
      while (row < rowEnds.length && rowEnds[row] > leftPx - 4) {
        row++;
      }
      if (row >= rowEnds.length) rowEnds.push(0);
      rowEnds[row] = leftPx + estimatedWidth;
      positions.push({ left: leftPct * 100, row });
    }
    return positions;
  }, [chunkWords, chunkStart]);

  // Drag handlers
  const handleDragStart = useCallback(
    (e: React.MouseEvent, idx: number) => {
      e.preventDefault();
      e.stopPropagation();
      setDraggingIndex(idx);
      dragStartX.current = e.clientX;
      dragStartTime.current = words[idx].start;
    },
    [words]
  );

  useEffect(() => {
    if (draggingIndex === null) return;

    const handleMove = (e: MouseEvent) => {
      if (!timelineRef.current) return;
      const containerWidth = timelineRef.current.getBoundingClientRect().width;
      const deltaX = e.clientX - dragStartX.current;
      const deltaTime = (deltaX / containerWidth) * CHUNK_DURATION;
      const newStart = Math.max(0, dragStartTime.current + deltaTime);
      const word = words[draggingIndex];
      const wordDuration = word.end - word.start;

      const updated = [...words];
      updated[draggingIndex] = {
        ...word,
        start: newStart,
        end: newStart + wordDuration,
      };
      onWordsChange(updated);
    };

    const handleUp = () => setDraggingIndex(null);

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [draggingIndex, words, onWordsChange]);

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

  // Find active word in this chunk
  const activeWordIndex = useMemo(() => {
    for (let i = chunkWords.length - 1; i >= 0; i--) {
      if (currentTime >= chunkWords[i].start) return chunkWords[i].globalIndex;
    }
    return -1;
  }, [chunkWords, currentTime]);

  const maxRow = useMemo(() => Math.max(0, ...wordPositions.map(p => p.row)), [wordPositions]);

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
          Bloco {currentChunk + 1} / {totalChunks} — {formatTimestamp(chunkStart)} → {formatTimestamp(chunkEnd)}
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

      {/* Waveform for chunk */}
      <div
        ref={containerRef}
        className="relative h-24 mx-4 mt-3 bg-muted/20 rounded-lg overflow-hidden cursor-pointer hover:bg-muted/30 transition-colors shrink-0"
        onClick={handleWaveformClick}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />
        {/* Time markers */}
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

      {/* Words timeline - positioned horizontally by timestamp */}
      <div
        ref={timelineRef}
        className="relative mx-4 mt-1 overflow-y-auto flex-1"
        style={{ minHeight: `${(maxRow + 1) * 36 + 20}px` }}
      >
        {/* Vertical guide lines for time markers */}
        {[0, 5, 10, 15, 20, 25, 30].map((sec) => {
          const t = chunkStart + sec;
          if (t > duration) return null;
          const leftPct = (sec / CHUNK_DURATION) * 100;
          return (
            <div
              key={sec}
              className="absolute top-0 bottom-0 border-l border-dashed border-muted-foreground/10"
              style={{ left: `${leftPct}%` }}
            />
          );
        })}

        {/* Playhead line in timeline */}
        {currentTime >= chunkStart && currentTime <= chunkEnd && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-primary/60 z-10 pointer-events-none"
            style={{ left: `${((currentTime - chunkStart) / CHUNK_DURATION) * 100}%` }}
          />
        )}

        {chunkWords.map((word, i) => {
          const idx = word.globalIndex;
          const pos = wordPositions[i] || { left: 0, row: 0 };
          const isActive = idx === activeWordIndex;
          const isPast = currentTime > word.end;
          const hasEdit = !!word.editedText;
          const hasTag = !!word.tag;
          const isDragging = draggingIndex === idx;

          if (editingIndex === idx) {
            return (
              <div
                key={idx}
                className="absolute"
                style={{ left: `${pos.left}%`, top: `${pos.row * 36 + 4}px` }}
              >
                <input
                  className="text-sm w-24 h-6 px-1 bg-background border border-border rounded"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") setEditingIndex(null);
                  }}
                  autoFocus
                />
              </div>
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
                  className={cn(
                    "absolute text-sm cursor-grab select-none whitespace-nowrap px-1 py-0.5 rounded transition-all duration-100",
                    isPast && "text-foreground",
                    isActive && "text-foreground bg-primary/20 font-semibold",
                    !isPast && !isActive && "text-muted-foreground/60",
                    hasEdit && "underline decoration-primary decoration-2 underline-offset-4",
                    hasTag && "border-b-2 border-dashed border-destructive",
                    isDragging && "opacity-70 cursor-grabbing z-20 scale-110",
                    !isDragging && "hover:bg-muted/40",
                  )}
                  style={{
                    left: `${pos.left}%`,
                    top: `${pos.row * 36 + 4}px`,
                  }}
                  onMouseDown={(e) => handleDragStart(e, idx)}
                  onClick={(e) => {
                    if (draggingIndex !== null) return;
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
  );
}
