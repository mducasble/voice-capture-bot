import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { type TimedWord } from "@/lib/reviewTypes";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { GripHorizontal, Save, X } from "lucide-react";

const ZOOM_MAX_SECONDS = 5;
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
  /** Start time of the zoom window in seconds */
  zoomStart: number;
  /** End time of the zoom window in seconds */
  zoomEnd: number;
  /** All peaks for the full audio (100 per second) */
  allPeaks: number[];
  /** All words from the recording */
  words: TimedWord[];
  /** Callback to save adjusted words */
  onWordsChange: (words: TimedWord[]) => void;
  onSeek: (time: number) => void;
}

interface DraftWord {
  globalIndex: number;
  text: string;
  editedText?: string;
  start: number;
  end: number;
  speaker?: string;
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
}: WaveformZoomDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomDuration = zoomEnd - zoomStart;

  // Local draft words for this zoom window
  const [draftWords, setDraftWords] = useState<DraftWord[]>([]);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragOrigStart, setDragOrigStart] = useState(0);
  const [dragOrigEnd, setDragOrigEnd] = useState(0);

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
    }
  }, [open, words, zoomStart, zoomEnd]);

  // Draw zoomed waveform
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

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Center line
    ctx.strokeStyle = "hsl(var(--muted-foreground) / 0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(CANVAS_WIDTH, midY);
    ctx.stroke();

    // Bars
    for (let i = 0; i < peaks.length; i++) {
      const barHeight = peaks[i] * (CANVAS_HEIGHT * 0.85);
      const x = i * barWidth;
      ctx.fillStyle = "hsl(var(--primary) / 0.35)";
      ctx.fillRect(x + 0.5, midY - barHeight / 2, Math.max(barWidth - 1, 1), barHeight);
    }

    // Draw word regions on canvas
    for (const word of draftWords) {
      const wStart = Math.max(word.start, zoomStart);
      const wEnd = Math.min(word.end, zoomEnd);
      const x1 = ((wStart - zoomStart) / zoomDuration) * CANVAS_WIDTH;
      const x2 = ((wEnd - zoomStart) / zoomDuration) * CANVAS_WIDTH;

      ctx.fillStyle = "hsl(var(--primary) / 0.12)";
      ctx.fillRect(x1, 0, x2 - x1, CANVAS_HEIGHT);

      // Word boundary lines
      ctx.strokeStyle = "hsl(var(--primary) / 0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, 0);
      ctx.lineTo(x1, CANVAS_HEIGHT);
      ctx.stroke();
    }
  }, [open, allPeaks, zoomStart, zoomEnd, zoomDuration, draftWords]);

  // Time position to px
  const timeToPx = useCallback(
    (t: number) => ((t - zoomStart) / zoomDuration) * CANVAS_WIDTH,
    [zoomStart, zoomDuration]
  );

  const pxToTime = useCallback(
    (px: number) => zoomStart + (px / CANVAS_WIDTH) * zoomDuration,
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
      // Clamp
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

  const handleSave = useCallback(() => {
    const updated = [...words];
    for (const dw of draftWords) {
      updated[dw.globalIndex] = {
        ...updated[dw.globalIndex],
        start: dw.start,
        end: dw.end,
      };
    }
    onWordsChange(updated);
    onOpenChange(false);
  }, [words, draftWords, onWordsChange, onOpenChange]);

  const hasChanges = useMemo(() => {
    return draftWords.some((dw) => {
      const orig = words[dw.globalIndex];
      return Math.abs(dw.start - orig.start) > 0.001 || Math.abs(dw.end - orig.end) > 0.001;
    });
  }, [draftWords, words]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[960px] p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-3">
          <DialogTitle className="text-sm font-medium">
            Zoom: {formatTs(zoomStart)} → {formatTs(zoomEnd)}
          </DialogTitle>
        </DialogHeader>

        {/* Zoomed waveform */}
        <div className="px-6">
          <div
            ref={containerRef}
            className="relative bg-muted/20 rounded-lg overflow-hidden"
            style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
          >
            <canvas ref={canvasRef} className="absolute inset-0" />
            {/* Timestamp labels */}
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

        {/* Word rows with drag handles */}
        <div className="px-6 py-3 max-h-[300px] overflow-y-auto">
          <div className="space-y-1">
            {draftWords.map((word, idx) => {
              const leftPx = timeToPx(Math.max(word.start, zoomStart));
              const rightPx = timeToPx(Math.min(word.end, zoomEnd));
              const widthPx = rightPx - leftPx;
              const isDragging = draggingIdx === idx;

              return (
                <div key={word.globalIndex} className="flex items-center gap-2 group">
                  {/* Word label */}
                  <span className="text-xs text-muted-foreground font-mono w-16 shrink-0 text-right truncate">
                    {formatTs(word.start)}
                  </span>
                  <span className="text-sm font-medium w-24 shrink-0 truncate" title={word.editedText ?? word.text}>
                    {word.editedText ?? word.text}
                  </span>

                  {/* Visual position bar */}
                  <div className="relative flex-1" style={{ height: 28 }}>
                    {/* Background track */}
                    <div className="absolute inset-0 bg-muted/20 rounded" />

                    {/* Draggable word block */}
                    <div
                      className={cn(
                        "absolute top-0 h-full rounded flex items-center justify-center cursor-grab active:cursor-grabbing transition-colors",
                        isDragging
                          ? "bg-primary/40 ring-2 ring-primary shadow-md"
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

                  <span className="text-xs text-muted-foreground font-mono w-16 shrink-0">
                    {formatTs(word.end)}
                  </span>
                </div>
              );
            })}

            {draftWords.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                Nenhuma palavra neste segmento.
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
