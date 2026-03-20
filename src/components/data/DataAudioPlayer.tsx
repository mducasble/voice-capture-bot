import { useState, useRef, useEffect, useCallback } from "react";
import { Play, Pause, Volume2, VolumeX, Download } from "lucide-react";
import { cn } from "@/lib/utils";

interface DataAudioPlayerProps {
  src: string;
  onPlay?: () => void;
  onPause?: () => void;
  onSeeked?: () => void;
}

const formatTime = (s: number) => {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

export function DataAudioPlayer({ src, onPlay, onPause, onSeeked }: DataAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play();
    } else {
      a.pause();
    }
  }, []);

  const seekTo = useCallback((clientX: number) => {
    const bar = progressRef.current;
    const a = audioRef.current;
    if (!bar || !a || !isFinite(a.duration)) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    a.currentTime = ratio * a.duration;
    onSeeked?.();
  }, [onSeeked]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setDragging(true);
    seekTo(e.clientX);
  }, [seekTo]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => seekTo(e.clientX);
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, seekTo]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-4 px-4 py-3 rounded-[0.625rem] bg-[hsl(0_0%_100%/0.05)] border border-[hsl(0_0%_100%/0.08)]">
      {/* Play / Pause */}
      <button
        onClick={toggle}
        className="h-10 w-10 shrink-0 rounded-lg bg-[hsl(88_100%_51%/0.15)] hover:bg-[hsl(88_100%_51%/0.25)] flex items-center justify-center transition-colors"
      >
        {playing ? (
          <Pause className="h-5 w-5 text-[#8cff05]" />
        ) : (
          <Play className="h-5 w-5 text-[#8cff05] ml-0.5" />
        )}
      </button>

      {/* Time */}
      <span className="text-[15px] font-semibold tabular-nums text-[#8cff05] w-[44px] text-right shrink-0">
        {formatTime(currentTime)}
      </span>

      {/* Progress bar */}
      <div
        ref={progressRef}
        className="flex-1 h-8 flex items-center cursor-pointer group"
        onMouseDown={handleMouseDown}
      >
        <div className="w-full h-[6px] rounded-full bg-white/[0.08] relative overflow-visible">
          <div
            className="h-full rounded-full bg-[#8cff05] transition-[width] duration-75"
            style={{ width: `${progress}%` }}
          />
          {/* Thumb */}
          <div
            className={cn(
              "absolute top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-[#8cff05] shadow-md transition-opacity",
              dragging ? "opacity-100 scale-110" : "opacity-0 group-hover:opacity-100"
            )}
            style={{ left: `calc(${progress}% - 8px)` }}
          />
        </div>
      </div>

      {/* Duration */}
      <span className="text-[15px] font-semibold tabular-nums text-[#8cff05] w-[44px] shrink-0">
        {formatTime(duration)}
      </span>

      {/* Download */}
      <a
        href={src}
        download
        className="h-10 w-10 shrink-0 rounded-md flex items-center justify-center transition-colors text-white/50 hover:text-[#8cff05]"
        title="Baixar áudio"
      >
        <Download className="h-5 w-5" />
      </a>

      {/* Mute */}
      <button
        onClick={() => {
          if (audioRef.current) audioRef.current.muted = !muted;
          setMuted(!muted);
        }}
        className="h-10 w-10 shrink-0 rounded-md flex items-center justify-center transition-colors text-red-500 hover:text-red-400"
      >
        {muted ? <Volume2 className="h-6 w-6" /> : <VolumeX className="h-6 w-6" />}
      </button>

      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={() => {
          if (audioRef.current) setDuration(audioRef.current.duration);
        }}
        onTimeUpdate={() => {
          if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
        }}
        onPlay={() => { setPlaying(true); onPlay?.(); }}
        onPause={() => { setPlaying(false); onPause?.(); }}
        onEnded={() => setPlaying(false)}
      />
    </div>
  );
}
