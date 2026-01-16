import { useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, Download, Clock, HardDrive, Mic2, Hash, Volume2, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { Recording } from "@/hooks/useRecordings";

interface RecordingCardProps {
  recording: Recording;
}

export function RecordingCard({ recording }: RecordingCardProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const togglePlay = () => {
    if (!audioRef.current || !recording.file_url) return;
    
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "0 MB";
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  return (
    <Card className="glass-card overflow-hidden animate-fade-in hover:border-primary/50 transition-colors">
      <CardContent className="p-0">
        <div className="flex items-stretch">
          {/* Play button section */}
          <div className="flex items-center justify-center p-6 border-r border-border/50">
            <Button
              variant="ghost"
              size="icon"
              className="h-14 w-14 rounded-full bg-primary/10 hover:bg-primary/20 text-primary"
              onClick={togglePlay}
              disabled={!recording.file_url}
            >
              {isPlaying ? (
                <Pause className="h-6 w-6" />
              ) : (
                <Play className="h-6 w-6 ml-1" />
              )}
            </Button>
            {recording.file_url && (
              <audio
                ref={audioRef}
                src={recording.file_url}
                onEnded={() => setIsPlaying(false)}
              />
            )}
          </div>

          {/* Content section */}
          <div className="flex-1 p-4 space-y-3">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-medium text-foreground flex items-center gap-2">
                  <Hash className="h-4 w-4 text-muted-foreground" />
                  {recording.discord_channel_name || "Unknown Channel"}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {recording.discord_guild_name || "Unknown Server"} • by {recording.discord_username || "Unknown"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Quality Badge */}
                {recording.quality_status && (
                  <Badge 
                    variant={recording.quality_status === "passed" ? "default" : "destructive"}
                    className={`flex items-center gap-1 ${recording.quality_status === "passed" ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}`}
                  >
                    {recording.quality_status === "passed" ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : (
                      <AlertTriangle className="h-3 w-3" />
                    )}
                    {recording.snr_db !== null ? `SNR ${recording.snr_db}dB` : recording.quality_status}
                  </Badge>
                )}
                <Badge 
                  variant={recording.status === "completed" ? "default" : "secondary"}
                  className={recording.status === "completed" ? "bg-accent text-accent-foreground" : ""}
                >
                  {recording.status}
                </Badge>
              </div>
            </div>

            {/* Stats */}
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-4 w-4" />
                {formatDuration(recording.duration_seconds)}
              </span>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <HardDrive className="h-4 w-4" />
                {formatFileSize(recording.file_size_bytes)}
              </span>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Mic2 className="h-4 w-4" />
                {recording.sample_rate / 1000}kHz • {recording.bit_depth}-bit • {recording.channels === 2 ? "Stereo" : "Mono"}
              </span>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-border/50">
              <span className="text-xs text-muted-foreground">
                {formatDate(recording.created_at)}
              </span>
              {recording.file_url && (
                <Button
                  variant="ghost"
                  size="sm"
                  asChild
                  className="text-muted-foreground hover:text-foreground"
                >
                  <a href={recording.file_url} download>
                    <Download className="h-4 w-4 mr-1" />
                    Download
                  </a>
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
