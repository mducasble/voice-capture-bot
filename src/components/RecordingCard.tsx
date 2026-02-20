import { useState, useRef } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, Clock, HardDrive, Mic2, Hash, AlertTriangle, CheckCircle2, FileText, Loader2, ChevronDown, ChevronUp, Globe, Trash2, FileAudio, FileVolume2, RotateCcw, AudioLines, File, Users, User, Activity, UsersRound, Download, PlayCircle, Eraser, FlaskConical, RefreshCw, FileJson, StopCircle, BarChart3, ScanLine, ClipboardCheck, Sparkles } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useRegenerateJson } from "@/hooks/useRegenerateJson";
import type { Recording } from "@/hooks/useRecordings";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useDeleteRecording } from "@/hooks/useDeleteRecording";
import { useReprocessRecording } from "@/hooks/useReprocessRecording";
import { useElevenLabsTranscription, type ElevenLabsMode } from "@/hooks/useElevenLabsTranscription";
import { useSessionTranscription } from "@/hooks/useSessionTranscription";
import { useResumeElevenLabsTranscription, getIncompleteTranscriptionInfo } from "@/hooks/useResumeElevenLabsTranscription";
import { useClearTranscription } from "@/hooks/useClearTranscription";
import { useStopGemini } from "@/hooks/useStopGemini";
import { useReanalyzeAudio } from "@/hooks/useReanalyzeAudio";
import { useEnhanceAudio } from "@/hooks/useEnhanceAudio";
import { useElevenLabsTestTranscription } from "@/hooks/useElevenLabsTestTranscription";
import { WaveformVisualizer } from "@/components/WaveformVisualizer";
import { SpeakerTranscript } from "@/components/SpeakerTranscript";
import { SpeakerAggregationProgress } from "@/components/SpeakerAggregationProgress";
import { ChunkGenerationProgress } from "@/components/ChunkGenerationProgress";
import { JsonPreviewDialog } from "@/components/JsonPreviewDialog";
import { TranscriptionCostDialog } from "@/components/TranscriptionCostDialog";
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
  const [isCostDialogOpen, setIsCostDialogOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const deleteRecording = useDeleteRecording();
  const reprocessRecording = useReprocessRecording();
  const elevenLabsTranscription = useElevenLabsTranscription();
  const sessionTranscription = useSessionTranscription();
  const resumeElevenLabs = useResumeElevenLabsTranscription();
  const clearTranscription = useClearTranscription();
  const stopGemini = useStopGemini();
  const elevenLabsTest = useElevenLabsTestTranscription();
  const regenerateJson = useRegenerateJson();
  const reanalyzeSampled = useReanalyzeAudio("sampled");
  const reanalyzeFull = useReanalyzeAudio("full_segments");
  const reanalyzeEnhancedSampled = useReanalyzeAudio("sampled", "enhanced");
  const reanalyzeEnhancedFull = useReanalyzeAudio("full_segments", "enhanced");
  const enhanceAudio = useEnhanceAudio();

  // Check if transcription is incomplete (stopped midway)
  const incompleteInfo = getIncompleteTranscriptionInfo(recording);

  // Check for speaker transcription in metadata
  const speakerTranscription = (recording.metadata as { speaker_transcription?: string })?.speaker_transcription;
  const readableSpeakerTranscription = (recording.metadata as { readable_transcription?: string })?.readable_transcription;
  const speakers = (recording.metadata as { speakers?: { username: string }[] })?.speakers;
  const geminiSegments = (recording.metadata as { gemini_segments?: { start: string; end: string; speaker: string; text: string }[] })?.gemini_segments;

  const speakerTranscriptText = (() => {
    if (readableSpeakerTranscription) return readableSpeakerTranscription;
    if (speakerTranscription) return speakerTranscription;
    if (!recording.transcription_elevenlabs) return null;

    // If ElevenLabs transcription is stored as JSON segments, convert it into
    // the "[speaker]: text" format expected by <SpeakerTranscript />.
    try {
      const parsed = JSON.parse(recording.transcription_elevenlabs);
      if (Array.isArray(parsed)) {
        return parsed
          .map((seg: any) => {
            const speaker = typeof seg?.speaker === "string" ? seg.speaker : "speaker";
            const text = typeof seg?.text === "string" ? seg.text : "";
            return text.trim() ? `[${speaker}]: ${text.trim()}` : null;
          })
          .filter(Boolean)
          .join("\n\n");
      }
    } catch {
      // ignore
    }

    return recording.transcription_elevenlabs;
  })();

  const handleDelete = () => {
    deleteRecording.mutate(recording.id);
  };

  const handleReprocess = () => {
    reprocessRecording.mutate(recording.id);
  };

  const handleElevenLabsTranscribe = (mode: ElevenLabsMode) => {
    elevenLabsTranscription.mutate({ recordingId: recording.id, mode });
  };

  const handleElevenLabsClick = () => {
    // Show cost estimation dialog before transcribing
    setIsCostDialogOpen(true);
  };

  const handleConfirmTranscription = () => {
    setIsCostDialogOpen(false);
    handleElevenLabsTranscribe('chunks');
  };

  // Get existing chunk count from state if available
  const existingChunkCount = (() => {
    const state = recording.elevenlabs_chunk_state as { chunkNames?: string[] } | null;
    return state?.chunkNames?.length ?? null;
  })();

  const handleResumeElevenLabs = () => {
    resumeElevenLabs.mutate({ recordingId: recording.id });
  };

  const handleClearTranscription = () => {
    clearTranscription.mutate(recording.id);
  };

  const handleElevenLabsTest = () => {
    elevenLabsTest.mutate({ recordingId: recording.id });
  };

  const handleRegenerateJson = () => {
    regenerateJson.mutate(recording.id);
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
      elevenlabs_words?: Array<{ text: string; start: number; end: number; speaker?: string }>;
    };

    // Prefer word-level segments from elevenlabs_words (with speaker labels remapped to A, B, C...)
    if (metadata?.elevenlabs_words && metadata.elevenlabs_words.length > 0) {
      // Build a mapping from raw speaker IDs (speaker_0, speaker_1) to letter labels (speaker_A, speaker_B)
      const rawToLabel = new Map<string, string>();
      const letterCode = (n: number) => String.fromCharCode(65 + n);
      
      const formatTs = (s: number) => {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${m}:${sec.toFixed(1).padStart(4, '0')}`;
      };
      const wordSegments = metadata.elevenlabs_words
        .filter(w => w.text?.trim())
        .map(w => {
          const rawSpeaker = w.speaker || 'unknown';
          if (!rawToLabel.has(rawSpeaker)) {
            rawToLabel.set(rawSpeaker, `speaker_${letterCode(rawToLabel.size)}`);
          }
          return {
            start: formatTs(w.start),
            end: formatTs(w.end),
            speaker: rawToLabel.get(rawSpeaker)!,
            text: w.text.trim(),
          };
        });
      return { segments: wordSegments, speakerMapping: metadata.speaker_mapping };
    }
    
    if (metadata?.speaker_segments && Array.isArray(metadata.speaker_segments) && metadata.speaker_segments.length > 0) {
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
                {/* Quality Badges */}
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
                {recording.quality_status === "passed" ? "Passed" : "Failed"}
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
            {recording.file_url && recording.status === 'completed' && (() => {
              const getColor = (level: 'good' | 'fair' | 'bad') => {
                if (level === 'good') return 'bg-green-500/20 text-green-400 border-green-500/30';
                if (level === 'fair') return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
                return 'bg-red-500/20 text-red-400 border-red-500/30';
              };

              type MetricDef = { label: string; value: string; level: 'good' | 'fair' | 'bad' };

              const buildMetrics = (meta: Record<string, unknown> | null, snrDb: number | null | undefined): MetricDef[] => {
                const metrics: MetricDef[] = [];
                // SNR: prefer explicit param, fallback to meta.snr_db (from HF API)
                const snr = snrDb ?? (meta?.snr_db as number | null | undefined);
                if (snr !== null && snr !== undefined) {
                  const level = snr >= 25 ? 'good' : snr >= 15 ? 'fair' : 'bad';
                  metrics.push({ label: 'SNR', value: `${snr} dB`, level });
                }
                if ((meta?.rms_dbfs as number) != null) {
                  const v = meta!.rms_dbfs as number;
                  const level = (v >= -26 && v <= -20) ? 'good' : 'bad';
                  metrics.push({ label: 'RMS', value: `${v.toFixed(1)} dBFS`, level });
                }
                if ((meta?.srmr as number) != null) {
                  const v = meta!.srmr as number;
                  const level = v >= 6 ? 'good' : v >= 10 ? 'fair' : 'bad';
                  metrics.push({ label: 'SRMR', value: `${v.toFixed(2)} dB`, level });
                }
                if ((meta?.wvmos as number) != null) {
                  const v = meta!.wvmos as number;
                  const level = v >= 1.5 ? 'good' : v >= 2.5 ? 'fair' : 'bad';
                  metrics.push({ label: 'WVMOS', value: v.toFixed(2), level });
                }
                if ((meta?.sigmos_ovrl as number) != null) {
                  const v = meta!.sigmos_ovrl as number;
                  const level = v >= 2.8 ? 'good' : v >= 2.5 ? 'fair' : 'bad';
                  metrics.push({ label: 'SigMOS Ovrl', value: v.toFixed(2), level });
                }
                if ((meta?.sigmos_disc as number) != null) {
                  const v = meta!.sigmos_disc as number;
                  const level = v >= 3.5 ? 'good' : v >= 2.5 ? 'fair' : 'bad';
                  metrics.push({ label: 'SigMOS Disc', value: v.toFixed(2), level });
                }
                if ((meta?.sigmos_reverb as number) != null) {
                  const v = meta!.sigmos_reverb as number;
                  const level = v >= 3.5 ? 'good' : v >= 2.5 ? 'fair' : 'bad';
                  metrics.push({ label: 'SigMOS Reverb', value: v.toFixed(2), level });
                }
                if ((meta?.vqscore as number) != null) {
                  const v = meta!.vqscore as number;
                  const level = v >= 0.65 ? 'good' : v >= 60 ? 'fair' : 'bad';
                  metrics.push({ label: 'VQScore', value: v.toFixed(1), level });
                }
                if ((meta?.mos_score as number) != null) {
                  const v = meta!.mos_score as number;
                  const level = v >= 3.5 ? 'good' : v >= 2.5 ? 'fair' : 'bad';
                  metrics.push({ label: 'MOS', value: v.toFixed(2), level });
                }
                if ((meta?.file_sr as number) != null) {
                  const v = meta!.file_sr as number;
                  metrics.push({ label: 'Device SR', value: `${(v / 1000).toFixed(1)} kHz`, level: 'good' });
                }
                if ((meta?.mic_sr as number) != null) {
                  const v = meta!.mic_sr as number;
                  const level = v >= 44100 ? 'good' : v >= 16000 ? 'fair' : 'bad';
                  metrics.push({ label: 'Eff. BW', value: `${(v / 1000).toFixed(1)} kHz`, level });
                }
                return metrics;
              };

              const renderMetricsTable = (metrics: MetricDef[], modeLabel: string | null, estimatedAt: string | null) => (
                <div className="space-y-1">
                  <div className="overflow-x-auto rounded-lg border border-border/50">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          {metrics.map((m) => (
                            <th key={m.label} className={`px-2 py-1.5 font-medium border-b border-border/50 text-center ${getColor(m.level)}`}>
                              {m.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {metrics.map((m) => (
                            <td key={m.label} className="px-2 py-2 text-center text-foreground font-mono text-xs">
                              {m.value}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {modeLabel && estimatedAt && (
                    <p className="text-[10px] text-muted-foreground text-right px-1">
                      {modeLabel} • {new Date(estimatedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              );

              const meta = recording.metadata as Record<string, unknown> | null;
              const originalMetrics = buildMetrics(meta, recording.snr_db);
              const enhancedMeta = meta?.enhanced_metrics as Record<string, unknown> | null;
              const enhancedMetrics = enhancedMeta ? buildMetrics(enhancedMeta, null) : [];

              const getModeLabel = (m: Record<string, unknown> | null) => {
                const mode = m?.metrics_mode as string | undefined;
                if (!mode) return null;
                if (mode.startsWith('full_segments')) return '🔬 Análise Completa';
                if (mode.startsWith('sampled')) return '📊 Análise Amostrada';
                if (mode.startsWith('full_mp3')) return '🎵 MP3 Completo';
                return mode;
              };

              return (
                <>
                  {/* Original Audio Quality Analysis */}
                  {originalMetrics.length > 0 && (
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
                      <CollapsibleContent className="mt-2 space-y-3">
                        {renderMetricsTable(
                          originalMetrics,
                          getModeLabel(meta),
                          meta?.metrics_estimated_at as string | null
                        )}
                        <WaveformVisualizer 
                          audioUrl={recording.file_url!} 
                          snrDb={recording.snr_db}
                          mosScore={(meta?.mos_score as number) ?? undefined}
                        />
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                  {/* Enhanced Audio Quality Analysis */}
                  {enhancedMetrics.length > 0 && (
                    <Collapsible>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="w-full justify-between text-violet-400 hover:text-violet-400">
                          <span className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4" />
                            Audio Quality Analysis (Enhanced)
                          </span>
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2 space-y-3">
                        {renderMetricsTable(
                          enhancedMetrics,
                          getModeLabel(enhancedMeta),
                          enhancedMeta?.metrics_estimated_at as string | null
                        )}
                        {(meta?.enhanced_file_url as string) && (
                          <WaveformVisualizer 
                            audioUrl={meta!.enhanced_file_url as string} 
                            snrDb={null}
                          />
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                  {/* Show original waveform even without metrics */}
                  {originalMetrics.length === 0 && (
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
                      <CollapsibleContent className="mt-2 space-y-3">
                        <WaveformVisualizer 
                          audioUrl={recording.file_url!} 
                          snrDb={recording.snr_db}
                          mosScore={(meta?.mos_score as number) ?? undefined}
                        />
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </>
              );
            })()}

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
                    <div className="space-y-2">
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
                      {/* Stop Gemini Button */}
                      <Button
                        variant="destructive"
                        size="sm"
                        className="w-full text-xs"
                        onClick={() => stopGemini.mutate(recording.id)}
                        disabled={stopGemini.isPending}
                      >
                        {stopGemini.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <StopCircle className="h-3 w-3 mr-1" />
                        )}
                        Parar Gemini
                      </Button>
                    </div>
                  )}
                  
                  {/* Display segments with timestamps if available, otherwise plain text */}
                  {geminiSegments && geminiSegments.length > 0 ? (
                    <div className="space-y-2">
                      <div className="bg-muted/50 rounded-lg p-3 text-sm text-foreground/90 max-h-48 overflow-y-auto space-y-2">
                        {geminiSegments.map((seg, i) => (
                          <div key={i} className="border-l-2 border-primary/40 pl-2">
                            <span className="text-xs text-muted-foreground">[{seg.start} - {seg.end}]</span>
                            <p className="whitespace-pre-wrap">{seg.text}</p>
                          </div>
                        ))}
                      </div>
                      <JsonPreviewDialog
                        segments={geminiSegments}
                        filename={`gemini_${recording.id.split('-')[0]}.json`}
                      >
                        <Button variant="outline" size="sm" className="w-full text-xs">
                          <FileJson className="h-3 w-3 mr-1" />
                          Ver/Baixar JSON (Gemini)
                        </Button>
                      </JsonPreviewDialog>
                    </div>
                  ) : (
                    <div className="bg-muted/50 rounded-lg p-3 text-sm text-foreground/90 max-h-48 overflow-y-auto">
                      <p className="whitespace-pre-wrap">{recording.transcription || 'Processando...'}</p>
                    </div>
                  )}
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
                      
                      // Prefer word-level view from elevenlabs_words metadata — subtitle format
                      const elWords = (recording.metadata as Record<string, unknown>)?.elevenlabs_words as Array<{ text: string; start: number; end: number; speaker?: string }> | undefined;
                      if (elWords && elWords.length > 0) {
                        const filteredWords = elWords.filter((w: { text: string }) => w.text?.trim());
                        const formatTs = (s: number) => {
                          const m = Math.floor(s / 60);
                          const sec = s % 60;
                          return `${m}:${sec.toFixed(1).padStart(4, '0')}`;
                        };

                        return (
                          <div className="space-y-0.5">
                            {filteredWords.map((w: { text: string; start: number; end: number; speaker?: string }, i: number) => (
                              <div key={i}>
                                <span className="text-[9px] text-muted-foreground/60 font-mono">
                                  [{formatTs(w.start)} → {formatTs(w.end)}]
                                </span>
                                <span className="ml-1.5">{w.text.trim()}</span>
                              </div>
                            ))}
                          </div>
                        );
                      }
                      
                      // Fallback: show speaker segments
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
            {recording.recording_type === 'mixed' && speakerTranscriptText && (
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
                    transcription={speakerTranscriptText} 
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
                {/* ElevenLabs Transcription button - shows cost dialog before transcribing */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleElevenLabsClick}
                  disabled={elevenLabsTranscription.isPending || recording.transcription_elevenlabs_status === 'processing'}
                  className="text-accent hover:text-accent hover:bg-accent/10"
                  title="Transcrever com ElevenLabs (mostra estimativa)"
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
                {/* Clear transcription button */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearTranscription}
                  disabled={clearTranscription.isPending}
                  className="text-yellow-500 hover:text-yellow-500 hover:bg-yellow-500/10"
                  title="Limpar transcrições"
                >
                  {clearTranscription.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Eraser className="h-4 w-4" />
                  )}
                </Button>
                {/* Regenerate JSON button - only when speaker_segments exist */}
                {(recording.metadata as { speaker_segments?: unknown })?.speaker_segments && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRegenerateJson}
                    disabled={regenerateJson.isPending}
                    className="text-cyan-500 hover:text-cyan-500 hover:bg-cyan-500/10"
                    title="Regenerar JSON (sem gastar créditos)"
                  >
                    {regenerateJson.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                )}
                {/* Review transcription button - when transcription is completed */}
                {(recording.transcription_elevenlabs_status === 'completed' || recording.transcription_status === 'completed') && (
                  <Button
                    variant="ghost"
                    size="sm"
                    asChild
                    className="text-indigo-500 hover:text-indigo-500 hover:bg-indigo-500/10"
                    title="Revisar transcrição"
                  >
                    <Link to={`/review?id=${recording.id}`}>
                      <ClipboardCheck className="h-4 w-4" />
                    </Link>
                  </Button>
                )}
                {/* Test ElevenLabs (4 minutes) - for validation */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleElevenLabsTest}
                  disabled={elevenLabsTest.isPending || recording.transcription_elevenlabs_status === 'processing'}
                  className="text-emerald-500 hover:text-emerald-500 hover:bg-emerald-500/10"
                  title="Teste: transcrever primeiros 4 minutos (força diarização)"
                >
                  {elevenLabsTest.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FlaskConical className="h-4 w-4" />
                  )}
                </Button>
                {/* Enhance audio button */}
                {recording.file_url && recording.status === 'completed' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => enhanceAudio.mutate({ recordingId: recording.id, fileUrl: recording.file_url! })}
                    disabled={enhanceAudio.isPending}
                    className="text-violet-500 hover:text-violet-500 hover:bg-violet-500/10"
                    title="Melhorar áudio (normalização, filtros, EQ)"
                  >
                    {enhanceAudio.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                  </Button>
                )}
                {/* Re-analyze audio metrics (sampled 10s/min) */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => reanalyzeSampled.mutate(recording.id)}
                  disabled={reanalyzeSampled.isPending || reanalyzeFull.isPending}
                  className="text-orange-500 hover:text-orange-500 hover:bg-orange-500/10"
                  title="Análise amostrada (10s por minuto)"
                >
                  {reanalyzeSampled.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <BarChart3 className="h-4 w-4" />
                  )}
                </Button>
                {/* Re-analyze audio metrics (full segments 1min) */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => reanalyzeFull.mutate(recording.id)}
                  disabled={reanalyzeFull.isPending || reanalyzeSampled.isPending}
                  className="text-amber-600 hover:text-amber-600 hover:bg-amber-600/10"
                  title="Análise completa (segmentos de 1 minuto)"
                >
                  {reanalyzeFull.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ScanLine className="h-4 w-4" />
                  )}
                </Button>
                {/* Re-analyze ENHANCED audio metrics (sampled) */}
                {(recording.metadata as Record<string, unknown>)?.enhanced_file_url && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => reanalyzeEnhancedSampled.mutate(recording.id)}
                    disabled={reanalyzeEnhancedSampled.isPending || reanalyzeEnhancedFull.isPending}
                    className="text-violet-400 hover:text-violet-400 hover:bg-violet-400/10"
                    title="Análise amostrada do áudio melhorado"
                  >
                    {reanalyzeEnhancedSampled.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <span className="relative">
                        <BarChart3 className="h-4 w-4" />
                        <Sparkles className="h-2.5 w-2.5 absolute -top-1 -right-1.5" />
                      </span>
                    )}
                  </Button>
                )}
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
                {/* Download Enhanced WAV */}
                {(recording.metadata as { enhanced_file_url?: string })?.enhanced_file_url && (
                  <Button
                    variant="ghost"
                    size="sm"
                    asChild
                    className="text-violet-500 hover:text-violet-500 hover:bg-violet-500/10"
                    title="Download WAV (melhorado)"
                  >
                    <a href={(recording.metadata as { enhanced_file_url: string }).enhanced_file_url} download>
                      <Sparkles className="h-4 w-4 mr-1" />
                      Enhanced
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

      {/* Cost estimation dialog */}
      <TranscriptionCostDialog
        open={isCostDialogOpen}
        onOpenChange={setIsCostDialogOpen}
        onConfirm={handleConfirmTranscription}
        durationSeconds={recording.duration_seconds}
        recordingType={recording.recording_type}
        sessionId={recording.session_id}
        existingChunks={existingChunkCount}
      />
    </Card>
  );
}
