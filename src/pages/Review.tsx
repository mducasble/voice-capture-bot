import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Play,
  Pause,
  SkipForward,
  Check,
  X,
  Gauge,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useReviewQueue, type ReviewRecording } from "@/hooks/useReviewQueue";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { ReviewWaveform } from "@/components/review/ReviewWaveform";
import { KaraokeText } from "@/components/review/KaraokeText";
import { extractTimedWords, type TimedWord } from "@/lib/reviewTypes";
import { toast } from "sonner";

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

export default function Review() {
  const { recordings, isLoading, submitReview } = useReviewQueue();
  const player = useAudioPlayer();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [words, setWords] = useState<TimedWord[]>([]);
  const [playbackRate, setPlaybackRate] = useState(1);

  const recording: ReviewRecording | undefined = recordings[currentIndex];

  // Load audio when recording changes
  useEffect(() => {
    if (!recording) return;
    const url = recording.mp3_file_url || recording.file_url;
    if (url) player.load(url);

    // Extract timed words
    const transcription =
      recording.transcription_elevenlabs || recording.transcription;
    const extracted = extractTimedWords(
      recording.metadata,
      transcription,
      recording.duration_seconds
    );
    setWords(extracted);
  }, [recording?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleApprove = useCallback(async () => {
    if (!recording) return;

    // Build edited transcription if any words were modified
    const hasEdits = words.some((w) => w.editedText || w.tag);
    const editedTranscription = hasEdits
      ? words.map((w) => {
          if (w.tag) return `[${w.tag}]`;
          return w.editedText ?? w.text;
        }).join(" ")
      : undefined;

    try {
      await submitReview.mutateAsync({
        recordingId: recording.id,
        action: "approved",
        editedTranscription,
      });
      toast.success("Transcrição aprovada!");
      advanceToNext();
    } catch {
      toast.error("Erro ao aprovar");
    }
  }, [recording, words, submitReview]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleReject = useCallback(async () => {
    if (!recording) return;
    try {
      await submitReview.mutateAsync({
        recordingId: recording.id,
        action: "rejected",
      });
      toast.success("Transcrição rejeitada");
      advanceToNext();
    } catch {
      toast.error("Erro ao rejeitar");
    }
  }, [recording, submitReview]); // eslint-disable-line react-hooks/exhaustive-deps

  const advanceToNext = useCallback(() => {
    player.pause();
    if (currentIndex < recordings.length - 1) {
      setCurrentIndex((i) => i + 1);
    }
  }, [currentIndex, recordings.length, player]);

  const handleSkip = useCallback(() => {
    advanceToNext();
  }, [advanceToNext]);

  const cyclePlaybackRate = useCallback(() => {
    const idx = PLAYBACK_RATES.indexOf(playbackRate);
    const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
    setPlaybackRate(next);
    player.setPlaybackRate(next);
  }, [playbackRate, player]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          player.toggle();
          break;
        case "ArrowRight":
          e.preventDefault();
          player.seek(Math.min(player.currentTime + 5, player.duration));
          break;
        case "ArrowLeft":
          e.preventDefault();
          player.seek(Math.max(player.currentTime - 5, 0));
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [player]);

  // Stats
  const editCount = useMemo(
    () => words.filter((w) => w.editedText).length,
    [words]
  );
  const tagCount = useMemo(
    () => words.filter((w) => w.tag).length,
    [words]
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground animate-pulse">
          Carregando fila de revisão...
        </div>
      </div>
    );
  }

  if (recordings.length === 0) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <FileText className="h-12 w-12 text-muted-foreground/50" />
        <p className="text-muted-foreground">
          Nenhuma transcrição pendente de revisão
        </p>
        <Button variant="outline" asChild>
          <Link to="/">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar ao Dashboard
          </Link>
        </Button>
      </div>
    );
  }

  if (!recording) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <Check className="h-12 w-12 text-primary" />
        <p className="text-foreground font-semibold text-lg">
          Todas as transcrições foram revisadas!
        </p>
        <Button variant="outline" asChild>
          <Link to="/">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar ao Dashboard
          </Link>
        </Button>
      </div>
    );
  }

  const audioUrl = recording.mp3_file_url || recording.file_url;
  const progress = player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <header className="border-b border-border px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-sm font-semibold text-foreground">
              Revisão de Transcrições
            </h1>
            <p className="text-xs text-muted-foreground">
              {currentIndex + 1} de {recordings.length}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {recording.discord_username && (
            <Badge variant="outline" className="text-xs">
              {recording.discord_username}
            </Badge>
          )}
          {recording.language && (
            <Badge variant="secondary" className="text-xs">
              {recording.language}
            </Badge>
          )}
          {editCount > 0 && (
            <Badge variant="outline" className="text-xs border-primary/50 text-primary">
              {editCount} edições
            </Badge>
          )}
          {tagCount > 0 && (
            <Badge variant="outline" className="text-xs border-destructive/50 text-destructive">
              {tagCount} marcações
            </Badge>
          )}
        </div>
      </header>

      {/* Progress bar */}
      <div className="h-1 bg-muted shrink-0">
        <div
          className="h-full bg-primary/60 transition-all duration-300"
          style={{ width: `${((currentIndex) / recordings.length) * 100}%` }}
        />
      </div>

      {/* Waveform + Controls */}
      <div className="px-6 pt-4 pb-2 space-y-3 shrink-0">
        {audioUrl && (
          <ReviewWaveform
            audioUrl={audioUrl}
            currentTime={player.currentTime}
            duration={player.duration}
            onSeek={player.seek}
          />
        )}

        {/* Player controls */}
        <div className="flex items-center justify-center gap-4">
          <span className="text-xs text-muted-foreground w-12 text-right tabular-nums">
            {formatTime(player.currentTime)}
          </span>

          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            onClick={() => player.seek(Math.max(player.currentTime - 5, 0))}
          >
            <span className="text-xs font-mono">-5s</span>
          </Button>

          <Button
            variant="default"
            size="icon"
            className="h-12 w-12 rounded-full"
            onClick={player.toggle}
          >
            {player.isPlaying ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5 ml-0.5" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            onClick={() =>
              player.seek(Math.min(player.currentTime + 5, player.duration))
            }
          >
            <span className="text-xs font-mono">+5s</span>
          </Button>

          <span className="text-xs text-muted-foreground w-12 tabular-nums">
            {formatTime(player.duration)}
          </span>

          <Button
            variant="outline"
            size="sm"
            className="ml-4 text-xs h-7 tabular-nums"
            onClick={cyclePlaybackRate}
          >
            <Gauge className="h-3 w-3 mr-1" />
            {playbackRate}x
          </Button>
        </div>
      </div>

      {/* Karaoke Text */}
      <div className="flex-1 min-h-0 border-t border-border">
        <KaraokeText
          words={words}
          currentTime={player.currentTime}
          onSeek={player.seek}
          onWordsChange={setWords}
          isPlaying={player.isPlaying}
        />
      </div>

      {/* Help text */}
      <div className="px-6 py-1 text-[10px] text-muted-foreground/60 text-center shrink-0">
        Clique na palavra para navegar • Duplo-clique para editar • Duplo-clique no tempo para ajustar • Botão direito para marcar erros • Espaço = play/pause • ← → = ±5s
      </div>

      {/* Action bar */}
      <footer className="border-t border-border px-6 py-3 flex items-center justify-between shrink-0">
        <Button variant="ghost" size="sm" onClick={handleSkip}>
          <SkipForward className="h-4 w-4 mr-2" />
          Pular
        </Button>

        <div className="flex items-center gap-3">
          <Button
            variant="destructive"
            size="sm"
            onClick={handleReject}
            disabled={submitReview.isPending}
          >
            <X className="h-4 w-4 mr-2" />
            Rejeitar
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleApprove}
            disabled={submitReview.isPending}
          >
            <Check className="h-4 w-4 mr-2" />
            Aprovar{editCount > 0 && ` (${editCount} edições)`}
          </Button>
        </div>
      </footer>
    </div>
  );
}
