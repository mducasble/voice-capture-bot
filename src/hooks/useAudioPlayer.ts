import { useRef, useState, useCallback, useEffect } from "react";

export interface AudioPlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isLoaded: boolean;
}

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<AudioPlayerState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    isLoaded: false,
  });

  const load = useCallback((url: string) => {
    // Cleanup previous
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }

    const audio = new Audio(url);
    audio.preload = "auto";
    audioRef.current = audio;

    setState({ isPlaying: false, currentTime: 0, duration: 0, isLoaded: false });

    audio.addEventListener("loadedmetadata", () => {
      setState(s => ({ ...s, duration: audio.duration, isLoaded: true }));
    });

    audio.addEventListener("timeupdate", () => {
      setState(s => ({ ...s, currentTime: audio.currentTime }));
    });

    audio.addEventListener("play", () => {
      setState(s => ({ ...s, isPlaying: true }));
    });

    audio.addEventListener("pause", () => {
      setState(s => ({ ...s, isPlaying: false }));
    });

    audio.addEventListener("ended", () => {
      setState(s => ({ ...s, isPlaying: false, currentTime: 0 }));
    });
  }, []);

  const play = useCallback(() => audioRef.current?.play(), []);
  const pause = useCallback(() => audioRef.current?.pause(), []);
  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.paused ? a.play() : a.pause();
  }, []);

  const seek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setState(s => ({ ...s, currentTime: time }));
    }
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, []);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setState({ isPlaying: false, currentTime: 0, duration: 0, isLoaded: false });
  }, []);

  useEffect(() => cleanup, [cleanup]);

  return {
    ...state,
    load,
    play,
    pause,
    toggle,
    seek,
    setPlaybackRate,
    cleanup,
  };
}
