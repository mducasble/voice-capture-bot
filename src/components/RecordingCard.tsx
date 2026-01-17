import { useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, Clock, HardDrive, Mic2, Hash, AlertTriangle, CheckCircle2, FileText, Loader2, ChevronDown, ChevronUp, Globe, Trash2, FileAudio, FileVolume2, RotateCcw, AudioLines } from "lucide-react";
import type { Recording } from "@/hooks/useRecordings";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useDeleteRecording } from "@/hooks/useDeleteRecording";
import { useReprocessRecording } from "@/hooks/useReprocessRecording";
import { useElevenLabsTranscription } from "@/hooks/useElevenLabsTranscription";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface RecordingCardProps {
  recording: Recording;
}

export function RecordingCard({ recording }: RecordingCardProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const deleteRecording = useDeleteRecording();
  const reprocessRecording = useReprocessRecording();
  const elevenLabsTranscription = useElevenLabsTranscription();

  const handleDelete = () => {
    deleteRecording.mutate(recording.id);
  };

  const handleReprocess = () => {
    reprocessRecording.mutate(recording.id);
  };

  const handleElevenLabsTranscribe = () => {
    elevenLabsTranscription.mutate(recording.id);
  };
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

  const getTranscriptionStatusBadge = () => {
    if (!recording.transcription_status) return null;
    
    switch (recording.transcription_status) {
      case 'completed':
        return (
          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 flex items-center gap-1">
            <FileText className="h-3 w-3" />
            Transcribed
          </Badge>
        );
      case 'processing':
        return (
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Transcribing...
          </Badge>
        );
      case 'failed':
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            Transcription Failed
          </Badge>
        );
      default:
        return null;
    }
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
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {/* Language Badge */}
                {recording.language && (
                  <Badge variant="outline" className="flex items-center gap-1">
                    <Globe className="h-3 w-3" />
                    {recording.language.toUpperCase()}
                  </Badge>
                )}
                {/* Transcription Status Badge */}
                {getTranscriptionStatusBadge()}
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

            {/* Transcription Section */}
            {recording.transcription && (
              <Collapsible open={isTranscriptOpen} onOpenChange={setIsTranscriptOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground hover:text-foreground">
                    <span className="flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      View Transcription
                    </span>
                    {isTranscriptOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <div className="bg-muted/50 rounded-lg p-3 text-sm text-foreground/90 max-h-48 overflow-y-auto">
                    <p className="whitespace-pre-wrap">{recording.transcription}</p>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-border/50">
              <span className="text-xs text-muted-foreground">
                {formatDate(recording.created_at)}
              </span>
              <div className="flex items-center gap-2">
                {/* ElevenLabs Transcription button */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleElevenLabsTranscribe}
                  disabled={elevenLabsTranscription.isPending}
                  className="text-purple-500 hover:text-purple-500 hover:bg-purple-500/10"
                  title="Transcrever com ElevenLabs"
                >
                  {elevenLabsTranscription.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <AudioLines className="h-4 w-4" />
                  )}
                </Button>
                {/* Reprocess button - always available */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReprocess}
                  disabled={reprocessRecording.isPending || recording.status === 'processing'}
                  className="text-primary hover:text-primary hover:bg-primary/10"
                  title="Reprocessar áudio (Gemini)"
                >
                  {reprocessRecording.isPending || recording.status === 'processing' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      disabled={deleteRecording.isPending}
                    >
                      {deleteRecording.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Deletar gravação?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta ação não pode ser desfeita. A gravação e todos os arquivos associados serão permanentemente deletados.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Deletar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                {recording.file_url && (
                  <Button
                    variant="ghost"
                    size="sm"
                    asChild
                    className="text-muted-foreground hover:text-foreground"
                    title="Download WAV (original)"
                  >
                    <a href={recording.file_url} download>
                      <FileAudio className="h-4 w-4 mr-1" />
                      WAV
                    </a>
                  </Button>
                )}
                {recording.mp3_file_url && (
                  <Button
                    variant="ghost"
                    size="sm"
                    asChild
                    className="text-muted-foreground hover:text-foreground"
                    title="Download comprimido (16kHz mono)"
                  >
                    <a href={recording.mp3_file_url} download>
                      <FileVolume2 className="h-4 w-4 mr-1" />
                      Comprimido
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
