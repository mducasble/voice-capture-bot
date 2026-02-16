import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { type TimedWord, type WordTag, WORD_TAG_LABELS } from "@/lib/reviewTypes";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const CHUNK_DURATION = 30; // seconds per chunk
const PAUSE_THRESHOLD = 0.5; // seconds of silence to split segments
const PUNCTUATION_RE = /[.!?;]$/;

function formatTimestamp(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 100);
  return `${m}:${sec.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}

/** A segment is a group of consecutive words forming a phrase */
interface Segment {
  words: { word: TimedWord; globalIndex: number }[];
  start: number;
  end: number;
  text: string;
}

/** Group words into segments by punctuation, pauses, and speaker changes */
function groupIntoSegments(
  words: { word: TimedWord; globalIndex: number }[]
): Segment[] {
  if (words.length === 0) return [];

  const segments: Segment[] = [];
  let current: { word: TimedWord; globalIndex: number }[] = [words[0]];

  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1].word;
    const curr = words[i].word;
    const pause = curr.start - prev.end;
    const punctuation = PUNCTUATION_RE.test((prev.editedText ?? prev.text).trim());
    const speakerChange = prev.speaker && curr.speaker && prev.speaker !== curr.speaker;

    if (pause > PAUSE_THRESHOLD || punctuation || speakerChange) {
      // Flush current segment
      segments.push(buildSegment(current));
      current = [words[i]];
    } else {
      current.push(words[i]);
    }
  }
  if (current.length > 0) segments.push(buildSegment(current));
  return segments;
}

function buildSegment(items: { word: TimedWord; globalIndex: number }[]): Segment {
  return {
    words: items,
    start: items[0].word.start,
    end: items[items.length - 1].word.end,
    text: items.map((w) => w.word.editedText ?? w.word.text).join(" "),
  };
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
  const [expandedSegment, setExpandedSegment] = useState<number | null>(null);
  const [tagMenuIndex, setTagMenuIndex] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [draggingSegIdx, setDraggingSegIdx] = useState<number | null>(null);
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

  // Words in current chunk with global indices
  const chunkWords = useMemo(() => {
    return words
      .map((w, i) => ({ word: w, globalIndex: i }))
      .filter((w) => w.word.start >= chunkStart && w.word.start < chunkEnd);
  }, [words, chunkStart, chunkEnd]);

  // Group into segments
  const segments = useMemo(() => groupIntoSegments(chunkWords), [chunkWords]);

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

  // Segment positions (staggered rows)
  const segmentPositions = useMemo(() => {
    if (!timelineRef.current) return segments.map(() => ({ left: 0, width: 0, row: 0 }));
    const containerWidth = timelineRef.current?.getBoundingClientRect().width || 800;

    const positions: { left: number; width: number; row: number }[] = [];
    const rowEnds: number[] = [];

    for (const seg of segments) {
      const leftPct = (seg.start - chunkStart) / CHUNK_DURATION;
      const widthPct = Math.max((seg.end - seg.start) / CHUNK_DURATION, 0.02);
      const leftPx = leftPct * containerWidth;
      const widthPx = Math.max(widthPct * containerWidth, seg.text.length * 7 + 32);

      let row = 0;
      while (row < rowEnds.length && rowEnds[row] > leftPx - 4) {
        row++;
      }
      if (row >= rowEnds.length) rowEnds.push(0);
      rowEnds[row] = leftPx + widthPx;
      positions.push({ left: leftPct * 100, width: widthPct * 100, row });
    }
    return positions;
  }, [segments, chunkStart]);

  // Drag segment handlers
  const handleSegDragStart = useCallback(
    (e: React.MouseEvent, segIdx: number) => {
      e.preventDefault();
      e.stopPropagation();
      setDraggingSegIdx(segIdx);
      dragStartX.current = e.clientX;
      dragStartTime.current = segments[segIdx].start;
    },
    [segments]
  );

  useEffect(() => {
    if (draggingSegIdx === null) return;

    const handleMove = (e: MouseEvent) => {
      if (!timelineRef.current) return;
      const containerWidth = timelineRef.current.getBoundingClientRect().width;
      const deltaX = e.clientX - dragStartX.current;
      const deltaTime = (deltaX / containerWidth) * CHUNK_DURATION;
      const seg = segments[draggingSegIdx];
      const newStart = Math.max(0, dragStartTime.current + deltaTime);
      const offset = newStart - seg.start;

      const updated = [...words];
      for (const { globalIndex } of seg.words) {
        const w = updated[globalIndex];
        updated[globalIndex] = {
          ...w,
          start: w.start + offset,
          end: w.end + offset,
        };
      }
      onWordsChange(updated);
    };

    const handleUp = () => setDraggingSegIdx(null);

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [draggingSegIdx, segments, words, onWordsChange]);

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

  // Active segment for highlighting
  const activeSegIdx = useMemo(() => {
    for (let i = segments.length - 1; i >= 0; i--) {
      if (currentTime >= segments[i].start) return i;
    }
    return -1;
  }, [segments, currentTime]);

  const maxRow = useMemo(
    () => Math.max(0, ...segmentPositions.map((p) => p.row)),
    [segmentPositions]
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

      {/* Waveform for chunk */}
      <div
        ref={containerRef}
        className="relative h-24 mx-4 mt-3 bg-muted/20 rounded-lg overflow-hidden cursor-pointer hover:bg-muted/30 transition-colors shrink-0"
        onClick={handleWaveformClick}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />
        <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2 pb-0.5">
          {[0, 5, 10, 15, 20, 25, 30].map((sec) => {
            const t = chunkStart + sec;
            if (t > duration) return null;
            return (
              <span
                key={sec}
                className="text-[9px] text-muted-foreground/50 tabular-nums font-mono"
              >
                {formatTimestamp(t)}
              </span>
            );
          })}
        </div>
      </div>

      {/* Segments timeline */}
      <div
        ref={timelineRef}
        className="relative mx-4 mt-1 overflow-y-auto flex-1"
        style={{ minHeight: `${(maxRow + 1) * 52 + 20}px` }}
      >
        {/* Vertical guide lines */}
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

        {/* Playhead line */}
        {currentTime >= chunkStart && currentTime <= chunkEnd && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-primary/60 z-10 pointer-events-none"
            style={{
              left: `${((currentTime - chunkStart) / CHUNK_DURATION) * 100}%`,
            }}
          />
        )}

        {segments.map((seg, segIdx) => {
          const pos = segmentPositions[segIdx] || { left: 0, width: 0, row: 0 };
          const isActive = segIdx === activeSegIdx;
          const isPast = currentTime > seg.end;
          const isDragging = draggingSegIdx === segIdx;
          const isExpanded = expandedSegment === segIdx;
          const hasEdits = seg.words.some((w) => w.word.editedText);
          const hasTags = seg.words.some((w) => w.word.tag);

          return (
            <div
              key={segIdx}
              className="absolute"
              style={{
                left: `${pos.left}%`,
                top: `${pos.row * 52 + 4}px`,
              }}
            >
              {/* Segment block */}
              <div
                className={cn(
                  "rounded-md border px-2 py-1 text-xs cursor-grab select-none transition-all duration-100 max-w-[280px]",
                  "border-border/60 bg-card/80",
                  isPast && "text-foreground",
                  isActive &&
                    "text-foreground bg-primary/15 border-primary/40 font-medium shadow-sm",
                  !isPast && !isActive && "text-muted-foreground/70",
                  hasEdits && "border-l-2 border-l-primary",
                  hasTags && "border-b-2 border-b-destructive/50",
                  isDragging && "opacity-70 cursor-grabbing z-20 scale-105 shadow-lg",
                  !isDragging && "hover:bg-muted/40 hover:border-border"
                )}
                onMouseDown={(e) => handleSegDragStart(e, segIdx)}
                onClick={(e) => {
                  if (draggingSegIdx !== null) return;
                  e.stopPropagation();
                  onSeek(seg.start);
                }}
              >
                <div className="flex items-center gap-1">
                  <span className="truncate leading-snug">
                    {seg.text}
                  </span>
                  <button
                    className="shrink-0 ml-auto p-0 text-muted-foreground/50 hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedSegment(isExpanded ? null : segIdx);
                    }}
                  >
                    {isExpanded ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                  </button>
                </div>
                <span className="text-[9px] text-muted-foreground/40 font-mono tabular-nums">
                  {formatTimestamp(seg.start)} → {formatTimestamp(seg.end)}
                </span>
              </div>

              {/* Expanded word-level editing */}
              {isExpanded && (
                <div className="mt-1 rounded-md border border-border/40 bg-card/90 p-1.5 space-y-0.5 z-30 relative max-w-[280px]">
                  {seg.words.map(({ word, globalIndex: gIdx }) => {
                    const isWordActive =
                      currentTime >= word.start && currentTime < word.end;

                    if (editingIndex === gIdx) {
                      return (
                        <input
                          key={gIdx}
                          className="text-xs w-full h-5 px-1 bg-background border border-border rounded"
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
                        key={gIdx}
                        open={tagMenuIndex === gIdx}
                        onOpenChange={(open) =>
                          setTagMenuIndex(open ? gIdx : null)
                        }
                      >
                        <PopoverTrigger asChild>
                          <span
                            className={cn(
                              "inline-block text-xs px-1 py-0.5 rounded cursor-pointer transition-colors",
                              isWordActive &&
                                "bg-primary/20 text-foreground font-semibold",
                              !isWordActive && "hover:bg-muted/40",
                              word.editedText &&
                                "underline decoration-primary decoration-2 underline-offset-2",
                              word.tag && "border-b border-dashed border-destructive"
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSeek(word.start);
                            }}
                            onDoubleClick={() => {
                              setEditingIndex(gIdx);
                              setEditValue(word.editedText ?? word.text);
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setTagMenuIndex(gIdx);
                            }}
                          >
                            {word.editedText ?? word.text}
                            {word.tag && (
                              <span className="ml-0.5 text-[9px]">
                                {WORD_TAG_LABELS[word.tag].emoji}
                              </span>
                            )}
                          </span>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-auto p-2 flex flex-col gap-1"
                          side="top"
                          align="center"
                        >
                          <p className="text-xs text-muted-foreground mb-1 px-1">
                            Marcar como:
                          </p>
                          {(
                            Object.entries(WORD_TAG_LABELS) as [
                              WordTag,
                              { label: string; emoji: string }
                            ][]
                          ).map(([tag, { label, emoji }]) => (
                            <Button
                              key={tag}
                              variant={word.tag === tag ? "default" : "ghost"}
                              size="sm"
                              className="justify-start text-xs h-7"
                              onClick={() =>
                                applyTag(gIdx, word.tag === tag ? null : tag)
                              }
                            >
                              {emoji} {label}
                            </Button>
                          ))}
                          {word.editedText && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="justify-start text-xs h-7 text-destructive"
                              onClick={() => {
                                const updated = [...words];
                                const { editedText: _, ...rest } = updated[gIdx];
                                updated[gIdx] = rest;
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
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
