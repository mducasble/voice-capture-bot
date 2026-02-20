import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { type TimedWord } from "@/lib/reviewTypes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { GripHorizontal, Save, X, Play, Pause, Plus, Pencil, Trash2 } from "lucide-react";

const CANVAS_WIDTH = 880;
const CANVAS_HEIGHT = 100;

function formatTs(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 100);
  return `${m}:${sec.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}

interface WaveformZoomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  zoomStart: number;
  zoomEnd: number;
  allPeaks: number[];
  words: TimedWord[];
  onWordsChange: (words: TimedWord[]) => void;
  onSeek: (time: number) => void;
  audioUrl: string;
}

interface DraftWord {
  globalIndex: number; // -1 for newly added words
  text: string;
  editedText?: string;
  start: number;
  end: number;
  speaker?: string;
  isNew?: boolean;
}

export function WaveformZoomDialog({
  open,
  onOpenChange,
  zoomStart,
  zoomEnd,
  allPeaks,
  words,
  onWordsChange,
  onSeek,
  audioUrl,
}: WaveformZoomDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animFrameRef = useRef<number>(0);
  const zoomDuration = zoomEnd - zoomStart;

  const [draftWords, setDraftWords] = useState<DraftWord[]>([]);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragOrigStart, setDragOrigStart] = useState(0);
  const [dragOrigEnd, setDragOrigEnd] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playTime, setPlayTime] = useState(zoomStart);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  // Initialize draft words when dialog opens
  useEffect(() => {
    if (open) {
      const zWords = words
        .map((w, i) => ({ ...w, globalIndex: i }))
        .filter((w) => w.start < zoomEnd && w.end > zoomStart);
      setDraftWords(
        zWords.map((w) => ({
          globalIndex: w.globalIndex,
          text: w.text,
          editedText: w.editedText,
          start: w.start,
          end: w.end,
          speaker: w.speaker,
        }))
      );
      setPlayTime(zoomStart);
      setIsPlaying(false);
    } else {
      // Cleanup audio on close
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    }
  }, [open, words, zoomStart, zoomEnd]);

  // Audio playback
  const togglePlay = useCallback(() => {
    if (!audioRef.current) {
      const audio = new Audio(audioUrl);
      audio.preload = "auto";
      audioRef.current = audio;
      audio.addEventListener("ended", () => setIsPlaying(false));
    }
    const audio = audioRef.current;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.currentTime = playTime;
      audio.play();
      setIsPlaying(true);
    }
  }, [audioUrl, isPlaying, playTime]);

  // Animation loop for playhead
  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(animFrameRef.current);
      return;
    }
    const tick = () => {
      const audio = audioRef.current;
      if (!audio) return;
      const t = audio.currentTime;
      if (t >= zoomEnd) {
        audio.pause();
        setIsPlaying(false);
        setPlayTime(zoomEnd);
        return;
      }
      setPlayTime(t);
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying, zoomEnd]);

  // Click on waveform to seek
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      const t = zoomStart + pct * zoomDuration;
      setPlayTime(t);
      if (audioRef.current) {
        audioRef.current.currentTime = t;
      }
    },
    [zoomStart, zoomDuration]
  );

  // Draw zoomed waveform + playhead
  useEffect(() => {
    if (!open || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_WIDTH * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;
    canvas.style.width = `${CANVAS_WIDTH}px`;
    canvas.style.height = `${CANVAS_HEIGHT}px`;
    ctx.scale(dpr, dpr);

    const peaksPerSecond = 100;
    const startPeak = Math.floor(zoomStart * peaksPerSecond);
    const endPeak = Math.min(Math.ceil(zoomEnd * peaksPerSecond), allPeaks.length);
    const peaks = allPeaks.slice(startPeak, endPeak);
    if (peaks.length === 0) return;

    const midY = CANVAS_HEIGHT / 2;
    const barWidth = CANVAS_WIDTH / peaks.length;
    const playPct = (playTime - zoomStart) / zoomDuration;
    const playedBarIdx = Math.floor(playPct * peaks.length);

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Center line
    ctx.strokeStyle = "hsl(var(--muted-foreground) / 0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(CANVAS_WIDTH, midY);
    ctx.stroke();

    // Word regions
    for (const word of draftWords) {
      const wStart = Math.max(word.start, zoomStart);
      const wEnd = Math.min(word.end, zoomEnd);
      const x1 = ((wStart - zoomStart) / zoomDuration) * CANVAS_WIDTH;
      const x2 = ((wEnd - zoomStart) / zoomDuration) * CANVAS_WIDTH;
      ctx.fillStyle = "hsl(var(--primary) / 0.12)";
      ctx.fillRect(x1, 0, x2 - x1, CANVAS_HEIGHT);
      ctx.strokeStyle = "hsl(var(--primary) / 0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, 0);
      ctx.lineTo(x1, CANVAS_HEIGHT);
      ctx.stroke();
    }

    // Bars with played color
    for (let i = 0; i < peaks.length; i++) {
      const barHeight = peaks[i] * (CANVAS_HEIGHT * 0.85);
      const x = i * barWidth;
      ctx.fillStyle = i <= playedBarIdx && playTime > zoomStart
        ? "hsl(var(--primary))"
        : "hsl(var(--primary) / 0.25)";
      ctx.fillRect(x + 0.5, midY - barHeight / 2, Math.max(barWidth - 1, 1), barHeight);
    }

    // Playhead
    if (playTime >= zoomStart && playTime <= zoomEnd) {
      const phX = ((playTime - zoomStart) / zoomDuration) * CANVAS_WIDTH;
      ctx.strokeStyle = "hsl(var(--primary))";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(phX, 0);
      ctx.lineTo(phX, CANVAS_HEIGHT);
      ctx.stroke();
    }
  }, [open, allPeaks, zoomStart, zoomEnd, zoomDuration, draftWords, playTime]);

  const timeToPx = useCallback(
    (t: number) => ((t - zoomStart) / zoomDuration) * CANVAS_WIDTH,
    [zoomStart, zoomDuration]
  );

  // Drag handlers
  const handleDragStart = useCallback(
    (e: React.MouseEvent, idx: number) => {
      e.preventDefault();
      setDraggingIdx(idx);
      setDragStartX(e.clientX);
      setDragOrigStart(draftWords[idx].start);
      setDragOrigEnd(draftWords[idx].end);
    },
    [draftWords]
  );

  useEffect(() => {
    if (draggingIdx === null) return;
    const handleMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartX;
      const dt = (dx / CANVAS_WIDTH) * zoomDuration;
      const wordDuration = dragOrigEnd - dragOrigStart;
      let newStart = dragOrigStart + dt;
      newStart = Math.max(zoomStart, Math.min(zoomEnd - wordDuration, newStart));
      const newEnd = newStart + wordDuration;
      setDraftWords((prev) => {
        const next = [...prev];
        next[draggingIdx] = { ...next[draggingIdx], start: newStart, end: newEnd };
        return next;
      });
    };
    const handleUp = () => setDraggingIdx(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [draggingIdx, dragStartX, dragOrigStart, dragOrigEnd, zoomStart, zoomEnd, zoomDuration]);

  // Add new word
  const handleAddWord = useCallback(() => {
    const defaultDuration = 0.3;
    // Place new word at current play position or center of zoom
    const insertTime = (playTime >= zoomStart && playTime <= zoomEnd) ? playTime : zoomStart + zoomDuration / 2;
    const newWord: DraftWord = {
      globalIndex: -1,
      text: "nova",
      start: insertTime,
      end: Math.min(insertTime + defaultDuration, zoomEnd),
      isNew: true,
    };
    setDraftWords((prev) => [...prev, newWord].sort((a, b) => a.start - b.start));
  }, [playTime, zoomStart, zoomEnd, zoomDuration]);

  // Remove word
  const handleRemoveWord = useCallback((idx: number) => {
    setDraftWords((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // Start editing
  const startEdit = useCallback((idx: number) => {
    setEditingIdx(idx);
    setEditText(draftWords[idx].editedText ?? draftWords[idx].text);
  }, [draftWords]);

  // Commit edit
  const commitEdit = useCallback(() => {
    if (editingIdx === null) return;
    const trimmed = editText.trim();
    if (trimmed) {
      setDraftWords((prev) => {
        const next = [...prev];
        const original = next[editingIdx].text;
        if (trimmed !== original) {
          next[editingIdx] = { ...next[editingIdx], editedText: trimmed };
        } else {
          const { editedText: _, ...rest } = next[editingIdx];
          next[editingIdx] = rest;
        }
        return next;
      });
    }
    setEditingIdx(null);
  }, [editingIdx, editText]);

  const handleSave = useCallback(() => {
    const updated = [...words];

    // First handle removals: collect globalIndexes still present
    const presentGlobalIndexes = new Set(
      draftWords.filter((dw) => dw.globalIndex >= 0).map((dw) => dw.globalIndex)
    );

    // Find original words in this zoom range
    const originalInRange = words
      .map((w, i) => ({ ...w, globalIndex: i }))
      .filter((w) => w.start < zoomEnd && w.end > zoomStart);

    // Remove words that were deleted (filter from back to front)
    const removedIndexes = originalInRange
      .filter((w) => !presentGlobalIndexes.has(w.globalIndex))
      .map((w) => w.globalIndex)
      .sort((a, b) => b - a);

    for (const ri of removedIndexes) {
      updated.splice(ri, 1);
    }

    // Update existing words (adjust indexes after removals)
    for (const dw of draftWords) {
      if (dw.globalIndex >= 0) {
        // Recalculate index after removals
        let adjustedIdx = dw.globalIndex;
        for (const ri of removedIndexes) {
          if (ri < dw.globalIndex) adjustedIdx--;
        }
        if (adjustedIdx >= 0 && adjustedIdx < updated.length) {
          updated[adjustedIdx] = {
            ...updated[adjustedIdx],
            start: dw.start,
            end: dw.end,
            ...(dw.editedText ? { editedText: dw.editedText } : {}),
          };
          // If editedText was removed, remove it from the word
          if (!dw.editedText && updated[adjustedIdx].editedText) {
            const { editedText: _, ...rest } = updated[adjustedIdx];
            updated[adjustedIdx] = rest;
          }
        }
      }
    }

    // Add new words
    const newWords = draftWords.filter((dw) => dw.globalIndex === -1);
    for (const nw of newWords) {
      const newTimedWord: TimedWord = {
        text: nw.editedText ?? nw.text,
        start: nw.start,
        end: nw.end,
        ...(nw.speaker ? { speaker: nw.speaker } : {}),
      };
      // Insert in correct position
      const insertIdx = updated.findIndex((w) => w.start > nw.start);
      if (insertIdx === -1) {
        updated.push(newTimedWord);
      } else {
        updated.splice(insertIdx, 0, newTimedWord);
      }
    }

    onWordsChange(updated);
    onOpenChange(false);
  }, [words, draftWords, onWordsChange, onOpenChange, zoomStart, zoomEnd]);

  const hasChanges = useMemo(() => {
    const originalInRange = words
      .map((w, i) => ({ ...w, globalIndex: i }))
      .filter((w) => w.start < zoomEnd && w.end > zoomStart);

    // Check for removals or additions
    const hasNew = draftWords.some((dw) => dw.globalIndex === -1);
    const hasRemoved = originalInRange.length !== draftWords.filter((dw) => dw.globalIndex >= 0).length;
    if (hasNew || hasRemoved) return true;

    return draftWords.some((dw) => {
      if (dw.globalIndex < 0) return true;
      const orig = words[dw.globalIndex];
      return (
        Math.abs(dw.start - orig.start) > 0.001 ||
        Math.abs(dw.end - orig.end) > 0.001 ||
        (dw.editedText ?? dw.text) !== (orig.editedText ?? orig.text)
      );
    });
  }, [draftWords, words, zoomStart, zoomEnd]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[960px] p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-3">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-sm font-medium">
              Zoom: {formatTs(zoomStart)} → {formatTs(zoomEnd)}
            </DialogTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-7" onClick={togglePlay}>
                {isPlaying ? <Pause className="h-3 w-3 mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                {isPlaying ? "Pausar" : "Reproduzir"}
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums font-mono w-16">
                {formatTs(playTime)}
              </span>
            </div>
          </div>
        </DialogHeader>

        {/* Zoomed waveform - clickable to seek */}
        <div className="px-6">
          <div
            ref={containerRef}
            className="relative bg-muted/20 rounded-lg overflow-hidden cursor-pointer"
            style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
            onClick={handleCanvasClick}
          >
            <canvas ref={canvasRef} className="absolute inset-0" />
            <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2 pb-0.5">
              {Array.from({ length: 6 }, (_, i) => {
                const t = zoomStart + (i / 5) * zoomDuration;
                return (
                  <span key={i} className="text-[9px] text-muted-foreground/50 tabular-nums font-mono">
                    {formatTs(t)}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        {/* Add word button */}
        <div className="px-6 pt-2 flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleAddWord}>
            <Plus className="h-3 w-3 mr-1" />
            Adicionar palavra
          </Button>
          <span className="text-[10px] text-muted-foreground">
            A palavra será inserida na posição atual do playhead
          </span>
        </div>

        {/* Word rows with drag handles */}
        <div className="px-6 py-3 max-h-[300px] overflow-y-auto">
          <div className="space-y-1">
            {draftWords.map((word, idx) => {
              const leftPx = timeToPx(Math.max(word.start, zoomStart));
              const rightPx = timeToPx(Math.min(word.end, zoomEnd));
              const widthPx = rightPx - leftPx;
              const isDragging = draggingIdx === idx;
              const isEditing = editingIdx === idx;

              return (
                <div key={`${word.globalIndex}-${idx}`} className="flex items-center gap-2 group">
                  {/* Timestamp */}
                  <span className="text-xs text-muted-foreground font-mono w-16 shrink-0 text-right tabular-nums">
                    {formatTs(word.start)}
                  </span>

                  {/* Word text or edit input */}
                  {isEditing ? (
                    <Input
                      className="h-6 w-24 text-sm px-1 py-0"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit();
                        if (e.key === "Escape") setEditingIdx(null);
                      }}
                      autoFocus
                    />
                  ) : (
                    <span
                      className={cn(
                        "text-sm font-medium w-24 shrink-0 truncate cursor-pointer hover:text-primary",
                        word.isNew && "text-primary italic"
                      )}
                      title={`Duplo-clique para editar: ${word.editedText ?? word.text}`}
                      onDoubleClick={() => startEdit(idx)}
                    >
                      {word.editedText ?? word.text}
                    </span>
                  )}

                  {/* Visual position bar */}
                  <div className="relative flex-1" style={{ height: 28 }}>
                    <div className="absolute inset-0 bg-muted/20 rounded" />
                    <div
                      className={cn(
                        "absolute top-0 h-full rounded flex items-center justify-center cursor-grab active:cursor-grabbing transition-colors",
                        isDragging
                          ? "bg-primary/40 ring-2 ring-primary shadow-md"
                          : word.isNew
                          ? "bg-primary/30 hover:bg-primary/40 border border-dashed border-primary/50"
                          : "bg-primary/20 hover:bg-primary/30"
                      )}
                      style={{
                        left: `${(leftPx / CANVAS_WIDTH) * 100}%`,
                        width: `${Math.max((widthPx / CANVAS_WIDTH) * 100, 2)}%`,
                      }}
                      onMouseDown={(e) => handleDragStart(e, idx)}
                    >
                      <GripHorizontal className="h-3 w-3 text-primary/60" />
                    </div>
                  </div>

                  <span className="text-xs text-muted-foreground font-mono w-16 shrink-0 tabular-nums">
                    {formatTs(word.end)}
                  </span>

                  {/* Edit & Delete buttons */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => startEdit(idx)}
                    title="Editar palavra"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                    onClick={() => handleRemoveWord(idx)}
                    title="Remover palavra"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}

            {draftWords.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                Nenhuma palavra neste segmento. Clique em "Adicionar palavra" para inserir.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="px-6 pb-5 pt-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4 mr-1" />
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!hasChanges}>
            <Save className="h-4 w-4 mr-1" />
            Salvar ajustes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
