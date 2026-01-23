import { useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, Clock, HardDrive, Mic2, Hash, AlertTriangle, CheckCircle2, FileText, Loader2, ChevronDown, ChevronUp, Globe, Trash2, FileAudio, FileVolume2, RotateCcw, AudioLines, File, Users, User, Activity, UsersRound, Download, PlayCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { Recording } from "@/hooks/useRecordings";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useDeleteRecording } from "@/hooks/useDeleteRecording";
import { useReprocessRecording } from "@/hooks/useReprocessRecording";
import { useElevenLabsTranscription, type ElevenLabsMode } from "@/hooks/useElevenLabsTranscription";
import { useSessionTranscription } from "@/hooks/useSessionTranscription";
import { useResumeElevenLabsTranscription, getIncompleteTranscriptionInfo } from "@/hooks/useResumeElevenLabsTranscription";
import { WaveformVisualizer } from "@/components/WaveformVisualizer";
import { SpeakerTranscript } from "@/components/SpeakerTranscript";
import { SpeakerAggregationProgress } from "@/components/SpeakerAggregationProgress";
import { ChunkGenerationProgress } from "@/components/ChunkGenerationProgress";
import { JsonPreviewDialog } from "@/components/JsonPreviewDialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface RecordingCardProps {
  recording: Recording;
}

export function RecordingCard({ recording }: RecordingCardProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);
  const [isElevenLabsTranscriptOpen, setIsElevenLabsTranscriptOpen] = useState(false);
  const [isSpeakerTranscriptOpen, setIsSpeakerTranscriptOpen] = useState(false);
  const [isWaveformOpen, setIsWaveformOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const deleteRecording = useDeleteRecording();
  const reprocessRecording = useReprocessRecording();
  const elevenLabsTranscription = useElevenLabsTranscription();
  const sessionTranscription = useSessionTranscription();
  const resumeElevenLabs = useResumeElevenLabsTranscription();

  // Check if transcription is incomplete (stopped midway)
  const incompleteInfo = getIncompleteTranscriptionInfo(recording);

  // Check for speaker transcription in metadata
  const speakerTranscription = (recording.metadata as { speaker_transcription?: string })?.speaker_transcription;
  const speakers = (recording.metadata as { speakers?: { username: string }[] })?.speakers;

  const handleDelete = () => {
    deleteRecording.mutate(recording.id);
  };

  const handleReprocess = () => {
    reprocessRecording.mutate(recording.id);
  };

  const handleElevenLabsTranscribe = (mode: ElevenLabsMode) => {
    elevenLabsTranscription.mutate({ recordingId: recording.id, mode });
  };

  const handleResumeElevenLabs = () => {
    resumeElevenLabs.mutate({ recordingId: recording.id });
  };

  const handleAggregateSession = () => {
    console.log('Aggregate session clicked', { 
      session_id: recording.session_id, 
      recording_id: recording.id 
    });
    if (recording.session_id) {
      sessionTranscription.mutate({ 
        sessionId: recording.session_id,
        mixedRecordingId: recording.id 
      });
    } else if (recording.recording_type === 'mixed') {
      // For mixed recordings without session_id, use the recording id to find session
      sessionTranscription.mutate({ 
        mixedRecordingId: recording.id 
      });
    }
  };

  // Get transcription segments for JSON preview/download
  const getTranscriptionSegments = (): { 
    segments: Array<{ start: string; end: string; speaker: string; text: string }>; 
    speakerMapping?: Record<string, string>;
  } | null => {
    const metadata = recording.metadata as {
      speaker_segments?: Array<{ start: string; end: string; speaker: string; text: string }>;
      speaker_mapping?: Record<string, string>;
    };
    
    if (metadata?.speaker_segments && Array.isArray(metadata.speaker_segments)) {
      return { 
        segments: metadata.speaker_segments,
        speakerMapping: metadata.speaker_mapping
      };
    }
    
    if (recording.transcription_elevenlabs) {
      try {
        const parsed = JSON.parse(recording.transcription_elevenlabs);
        if (Array.isArray(parsed)) {
          return { segments: parsed, speakerMapping: metadata?.speaker_mapping };
        }
      } catch {
        // If not valid JSON, create a simple format
        return {
          segments: [{
            start: "0:00",
            end: "0:00",
            speaker: "speaker A",
            text: recording.transcription_elevenlabs
          }]
        };
      }
    }
    
    return null;
  };

  const transcriptionData = recording.transcription_elevenlabs && recording.transcription_elevenlabs_status === 'completed' 
    ? getTranscriptionSegments() 
    : null;

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
                  <code className="text-xs font-mono text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                    {recording.id.split('-')[0]}
                  </code>
                </h3>
                <p className="text-sm text-muted-foreground">
                  {recording.discord_guild_name || "Unknown Server"} • by {recording.discord_username || "Unknown"}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {/* Recording Type Badge */}
                {recording.recording_type && (
                  <Badge 
                    variant="outline" 
                    className={`flex items-center gap-1 ${
                      recording.recording_type === 'individual' 
                        ? 'bg-purple-500/20 text-purple-400 border-purple-500/30' 
                        : 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
                    }`}
                  >
                    {recording.recording_type === 'individual' ? (
                      <User className="h-3 w-3" />
                    ) : (
                      <Users className="h-3 w-3" />
                    )}
                    {recording.recording_type === 'individual' ? 'Individual' : 'Mixed'}
                  </Badge>
                )}
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

            {/* Chunk Generation Progress (for recordings being processed) */}
            <ChunkGenerationProgress recording={recording} />

            {/* Waveform Visualizer Section */}
            {recording.file_url && recording.status === 'completed' && (
              <Collapsible open={isWaveformOpen} onOpenChange={setIsWaveformOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground hover:text-foreground">
                    <span className="flex items-center gap-2">
                      <Activity className="h-4 w-4" />
                      Audio Quality Analysis
                    </span>
                    {isWaveformOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <WaveformVisualizer 
                    audioUrl={recording.file_url} 
                    snrDb={recording.snr_db}
                  />
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Transcription Section - Gemini */}
            {(recording.transcription || recording.transcription_status === 'processing') && (
              <Collapsible open={isTranscriptOpen} onOpenChange={setIsTranscriptOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground hover:text-foreground">
                    <span className="flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Transcrição (Gemini)
                      {recording.transcription_status === 'processing' && (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {recording.gemini_chunk_state && recording.gemini_chunk_state.chunkUrls?.length > 0 ? (
                            <span className="text-xs text-muted-foreground">
                              ({Math.round((recording.gemini_chunk_state.nextIndex / recording.gemini_chunk_state.chunkUrls.length) * 100)}%)
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">(iniciando...)</span>
                          )}
                        </>
                      )}
                    </span>
                    {isTranscriptOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-2">
                  {/* Progress bar while processing */}
                  {recording.transcription_status === 'processing' && (
                    <div className="space-y-1">
                      {recording.gemini_chunk_state && recording.gemini_chunk_state.chunkUrls?.length > 0 ? (
                        <>
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Processando chunks...</span>
                            <span>
                              {recording.gemini_chunk_state.nextIndex} / {recording.gemini_chunk_state.chunkUrls.length} ({Math.round((recording.gemini_chunk_state.nextIndex / recording.gemini_chunk_state.chunkUrls.length) * 100)}%)
                            </span>
                          </div>
                          <Progress 
                            value={(recording.gemini_chunk_state.nextIndex / recording.gemini_chunk_state.chunkUrls.length) * 100} 
                            className="h-2"
                          />
                        </>
                      ) : (
                        <>
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Preparando transcrição...</span>
                            <Loader2 className="h-3 w-3 animate-spin" />
                          </div>
                          <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                            <div className="h-full bg-primary/50 animate-pulse" style={{ width: '100%' }} />
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  <div className="bg-muted/50 rounded-lg p-3 text-sm text-foreground/90 max-h-48 overflow-y-auto">
                    <p className="whitespace-pre-wrap">{recording.transcription || 'Processando...'}</p>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Transcription Section - ElevenLabs */}
            {(recording.transcription_elevenlabs || recording.transcription_elevenlabs_status === 'processing' || incompleteInfo.isIncomplete) && (
              <Collapsible open={isElevenLabsTranscriptOpen} onOpenChange={setIsElevenLabsTranscriptOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className={`w-full justify-between ${incompleteInfo.isIncomplete ? 'text-orange-400 hover:text-orange-400' : 'text-accent hover:text-accent'}`}>
                    <span className="flex items-center gap-2">
                      <AudioLines className="h-4 w-4" />
                      Transcrição (ElevenLabs)
                      {recording.transcription_elevenlabs_status === 'processing' && (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {recording.elevenlabs_chunk_state && recording.elevenlabs_chunk_state.chunkNames?.length > 0 ? (
                            <span className="text-xs text-muted-foreground">
                              ({Math.round((recording.elevenlabs_chunk_state.nextIndex / recording.elevenlabs_chunk_state.chunkNames.length) * 100)}%)
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">(arquivo completo)</span>
                          )}
                        </>
                      )}
                      {incompleteInfo.isIncomplete && recording.transcription_elevenlabs_status !== 'processing' && (
                        <Badge variant="outline" className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs">
                          {incompleteInfo.percentComplete}% - {incompleteInfo.reason === 'quota_exceeded' ? 'Créditos esgotados' : 'Incompleto'}
                        </Badge>
                      )}
                    </span>
                    {isElevenLabsTranscriptOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-2">
                  {/* Progress bar while processing */}
                  {recording.transcription_elevenlabs_status === 'processing' && (
                    <div className="space-y-1">
                      {recording.elevenlabs_chunk_state && recording.elevenlabs_chunk_state.chunkNames?.length > 0 ? (
                        <>
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Processando chunks...</span>
                            <span>
                              {recording.elevenlabs_chunk_state.nextIndex} / {recording.elevenlabs_chunk_state.chunkNames.length} ({Math.round((recording.elevenlabs_chunk_state.nextIndex / recording.elevenlabs_chunk_state.chunkNames.length) * 100)}%)
                            </span>
                          </div>
                          <Progress 
                            value={(recording.elevenlabs_chunk_state.nextIndex / recording.elevenlabs_chunk_state.chunkNames.length) * 100} 
                            className="h-2"
                          />
                        </>
                      ) : (
                        <>
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Transcrevendo arquivo completo...</span>
                            <Loader2 className="h-3 w-3 animate-spin" />
                          </div>
                          <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                            <div className="h-full bg-accent/50 animate-pulse" style={{ width: '100%' }} />
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  <div className="bg-accent/10 border border-accent/20 rounded-lg p-3 text-sm text-foreground/90 max-h-48 overflow-y-auto">
                    {(() => {
                      if (!recording.transcription_elevenlabs) return <p>Processando...</p>;
                      try {
                        const segments = JSON.parse(recording.transcription_elevenlabs);
                        if (Array.isArray(segments)) {
                          return (
                            <div className="space-y-2">
                              {segments.map((seg: { start: string; end: string; speaker: string; text: string }, i: number) => (
                                <div key={i} className="border-l-2 border-accent/40 pl-2">
                                  <span className="text-xs text-muted-foreground">[{seg.start} - {seg.end}] {seg.speaker}</span>
                                  <p className="whitespace-pre-wrap">{seg.text}</p>
                                </div>
                              ))}
                            </div>
                          );
                        }
                        return <p className="whitespace-pre-wrap">{recording.transcription_elevenlabs}</p>;
                      } catch {
                        return <p className="whitespace-pre-wrap">{recording.transcription_elevenlabs}</p>;
                      }
                    })()}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Speaker Aggregation Progress (for mixed recordings) */}
            {recording.recording_type === 'mixed' && (
              <SpeakerAggregationProgress recording={recording} />
            )}

            {/* Speaker-Identified Transcription Section (for mixed recordings with session) */}
            {recording.recording_type === 'mixed' && recording.transcription_elevenlabs && (
              <Collapsible open={isSpeakerTranscriptOpen} onOpenChange={setIsSpeakerTranscriptOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between text-purple-400 hover:text-purple-400">
                    <span className="flex items-center gap-2">
                      <UsersRound className="h-4 w-4" />
                      Transcrição por Speaker
                      {speakers && (
                        <span className="text-xs text-muted-foreground">
                          ({speakers.length} participantes)
                        </span>
                      )}
                    </span>
                    {isSpeakerTranscriptOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <SpeakerTranscript 
                    transcription={recording.transcription_elevenlabs} 
                    speakers={speakers}
                  />
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-border/50">
              <span className="text-xs text-muted-foreground">
                {formatDate(recording.created_at)}
              </span>
              <div className="flex items-center gap-2">
                {/* Aggregate Session Transcription button - only for mixed recordings with a session_id (Discord sessions) */}
                {recording.recording_type === 'mixed' && recording.session_id && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleAggregateSession}
                    disabled={sessionTranscription.isPending}
                    className="text-purple-400 hover:text-purple-400 hover:bg-purple-500/10"
                    title="Agregar transcrições por speaker"
                  >
                    {sessionTranscription.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <UsersRound className="h-4 w-4" />
                    )}
                  </Button>
                )}
                {/* ElevenLabs Transcription button - always uses chunks mode for reliability */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleElevenLabsTranscribe('chunks')}
                  disabled={elevenLabsTranscription.isPending || recording.transcription_elevenlabs_status === 'processing'}
                  className="text-accent hover:text-accent hover:bg-accent/10"
                  title="Transcrever com ElevenLabs"
                >
                  {elevenLabsTranscription.isPending || recording.transcription_elevenlabs_status === 'processing' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <AudioLines className="h-4 w-4" />
                  )}
                </Button>
                {/* Resume ElevenLabs button - shows when transcription is incomplete */}
                {incompleteInfo.isIncomplete && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleResumeElevenLabs}
                    disabled={resumeElevenLabs.isPending || recording.transcription_elevenlabs_status === 'processing'}
                    className="text-orange-400 hover:text-orange-400 hover:bg-orange-500/10"
                    title={`Retomar transcrição (${incompleteInfo.percentComplete}% concluído, ~${Math.round(incompleteInfo.estimatedMissingSeconds / 60)}min restantes)`}
                  >
                    {resumeElevenLabs.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <PlayCircle className="h-4 w-4" />
                    )}
                  </Button>
                )}
                {/* Reprocess button - always available, only disabled during local mutation */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReprocess}
                  disabled={reprocessRecording.isPending}
                  className="text-primary hover:text-primary hover:bg-primary/10"
                  title="Reprocessar áudio (Gemini)"
                >
                  {reprocessRecording.isPending ? (
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
                {transcriptionData && (
                  <JsonPreviewDialog
                    segments={transcriptionData.segments}
                    speakerMapping={transcriptionData.speakerMapping}
                    filename={`transcription-${recording.discord_channel_name || recording.id}.json`}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-accent hover:text-accent hover:bg-accent/10"
                      title="Preview e download da transcrição JSON"
                    >
                      <Download className="h-4 w-4 mr-1" />
                      JSON
                    </Button>
                  </JsonPreviewDialog>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
