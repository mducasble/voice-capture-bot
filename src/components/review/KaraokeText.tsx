import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { type TimedWord, type WordTag, WORD_TAG_LABELS } from "@/lib/reviewTypes";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface KaraokeTextProps {
  words: TimedWord[];
  currentTime: number;
  onSeek: (time: number) => void;
  onWordsChange: (words: TimedWord[]) => void;
  isPlaying: boolean;
}

export function KaraokeText({
  words,
  currentTime,
  onSeek,
  onWordsChange,
  isPlaying,
}: KaraokeTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLSpanElement>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [tagMenuIndex, setTagMenuIndex] = useState<number | null>(null);

  // Find current active word
  const activeWordIndex = useMemo(() => {
    for (let i = words.length - 1; i >= 0; i--) {
      if (currentTime >= words[i].start) return i;
    }
    return -1;
  }, [words, currentTime]);

  // Auto-scroll to active word
  useEffect(() => {
    if (activeRef.current && isPlaying) {
      activeRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [activeWordIndex, isPlaying]);

  const handleWordClick = useCallback(
    (index: number) => {
      onSeek(words[index].start);
    },
    [words, onSeek]
  );

  const handleWordDoubleClick = useCallback(
    (index: number) => {
      setEditingIndex(index);
      setEditValue(words[index].editedText ?? words[index].text);
    },
    [words]
  );

  const commitEdit = useCallback(() => {
    if (editingIndex === null) return;
    const updated = [...words];
    const original = updated[editingIndex].text;
    const newText = editValue.trim();
    if (newText && newText !== original) {
      updated[editingIndex] = { ...updated[editingIndex], editedText: newText };
    } else {
      // Clear edit if same as original
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

  // Group words into lines (~12 words per line for readability)
  const lines = useMemo(() => {
    const result: { words: (TimedWord & { globalIndex: number })[]; }[] = [];
    let currentLine: (TimedWord & { globalIndex: number })[] = [];

    words.forEach((word, i) => {
      currentLine.push({ ...word, globalIndex: i });
      // Break on punctuation + space or every ~12 words
      const endsWithPunctuation = /[.!?;]$/.test(word.text);
      if (endsWithPunctuation || currentLine.length >= 12) {
        result.push({ words: currentLine });
        currentLine = [];
      }
    });

    if (currentLine.length > 0) {
      result.push({ words: currentLine });
    }
    return result;
  }, [words]);

  if (words.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Nenhuma transcrição com timestamps disponível
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-6 py-4 space-y-3 text-lg leading-relaxed select-none"
    >
      {lines.map((line, lineIdx) => (
        <p key={lineIdx} className="flex flex-wrap gap-x-1.5 gap-y-1">
          {line.words.map((word) => {
            const idx = word.globalIndex;
            const isActive = idx === activeWordIndex;
            const isPast = idx < activeWordIndex;
            const hasEdit = !!word.editedText;
            const hasTag = !!word.tag;

            if (editingIndex === idx) {
              return (
                <Input
                  key={idx}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") setEditingIndex(null);
                  }}
                  className="inline-block w-auto min-w-[60px] h-7 text-lg px-1 py-0"
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
                    ref={isActive ? activeRef : undefined}
                    className={cn(
                      "cursor-pointer rounded px-0.5 py-0.5 transition-all duration-150 relative",
                      isPast && "text-foreground",
                      isActive && "text-foreground bg-primary/20 font-semibold scale-105",
                      !isPast && !isActive && "text-muted-foreground/50",
                      hasEdit && "underline decoration-primary decoration-2 underline-offset-4",
                      hasTag && "border-b-2 border-dashed border-destructive",
                    )}
                    onClick={() => handleWordClick(idx)}
                    onDoubleClick={() => handleWordDoubleClick(idx)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setTagMenuIndex(idx);
                    }}
                  >
                    {word.editedText ?? word.text}
                    {hasTag && (
                      <span className="absolute -top-3 -right-1 text-[10px]">
                        {WORD_TAG_LABELS[word.tag!].emoji}
                      </span>
                    )}
                  </span>
                </PopoverTrigger>
                <PopoverContent
                  className="w-auto p-2 flex flex-col gap-1"
                  side="top"
                  align="center"
                >
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
        </p>
      ))}
    </div>
  );
}
