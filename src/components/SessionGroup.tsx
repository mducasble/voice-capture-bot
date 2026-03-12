import { useState, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Users, User, Clock, HardDrive, Hash, ChevronDown, ChevronUp, Calendar, Layers, Pencil } from "lucide-react";
import { RecordingCard } from "@/components/RecordingCard";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Recording } from "@/hooks/useRecordings";

interface SessionGroupProps {
  sessionId: string | null;
  recordings: Recording[];
}

export function SessionGroup({ sessionId, recordings }: SessionGroupProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const queryClient = useQueryClient();

  // Separate mixed and individual recordings
  const mixedRecording = recordings.find(r => r.recording_type === 'mixed');
  const individualRecordings = recordings.filter(r => r.recording_type === 'individual' || r.recording_type === 'remote_backup');
  
  // Get session metadata from any recording
  const firstRecording = recordings[0];
  const channelName = firstRecording?.discord_channel_name || "Unknown Channel";
  const guildName = firstRecording?.discord_guild_name || "Unknown Server";
  const createdAt = firstRecording?.created_at;

  // Tema: use metadata.tema from mixedRecording or firstRecording, fallback to channelName
  const temaSource = mixedRecording || firstRecording;
  const savedTema = (temaSource?.metadata as Record<string, unknown>)?.tema as string | undefined;

  const [isEditingTema, setIsEditingTema] = useState(false);
  const [temaValue, setTemaValue] = useState(savedTema || channelName);
  const temaInputRef = useRef<HTMLInputElement>(null);

  // Calculate totals
  const totalDuration = recordings.reduce((sum, r) => sum + (r.duration_seconds || 0), 0);
  const totalSize = recordings.reduce((sum, r) => sum + (r.file_size_bytes || 0), 0);
  const participantCount = individualRecordings.length;

  const formatDuration = (seconds: number) => {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes) return "0 MB";
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const handleSaveTema = useCallback(async () => {
    setIsEditingTema(false);
    const trimmed = temaValue.trim() || channelName;
    setTemaValue(trimmed);
    const targetId = temaSource?.id;
    if (!targetId) return;
    try {
      const { data } = await supabase
        .from('voice_recordings')
        .select('metadata')
        .eq('id', targetId)
        .single();
      const currentMeta = (data?.metadata as Record<string, unknown>) || {};
      await supabase
        .from('voice_recordings')
        .update({ metadata: { ...currentMeta, tema: trimmed } })
        .eq('id', targetId);
      queryClient.invalidateQueries({ queryKey: ['recordings'] });
    } catch {
      toast.error('Erro ao salvar tema');
    }
  }, [temaValue, channelName, temaSource?.id, queryClient]);

  // If there's no session_id, it's a standalone recording
  if (!sessionId || recordings.length === 1) {
    return <RecordingCard recording={recordings[0]} />;
  }

  return (
    <Card className="glass-card overflow-hidden animate-fade-in border-primary/30">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader className="pb-2">
          <CollapsibleTrigger asChild>
            <Button 
              variant="ghost" 
              className="w-full justify-between p-0 h-auto hover:bg-transparent"
            >
              <div className="flex items-start gap-4 text-left">
                {/* Session icon */}
                <div className="p-3 rounded-lg bg-primary/10">
                  <Layers className="h-6 w-6 text-primary" />
                </div>

                {/* Session info */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Hash className="h-4 w-4 text-muted-foreground" />
                    {isEditingTema ? (
                      <Input
                        ref={temaInputRef}
                        value={temaValue}
                        onChange={(e) => setTemaValue(e.target.value)}
                        onBlur={handleSaveTema}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') handleSaveTema();
                          if (e.key === 'Escape') {
                            setIsEditingTema(false);
                            setTemaValue(savedTema || channelName);
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="h-7 text-sm font-medium max-w-xs"
                        autoFocus
                      />
                    ) : (
                      <span
                        className="font-medium text-foreground flex items-center gap-1.5 cursor-pointer group"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsEditingTema(true);
                          setTimeout(() => temaInputRef.current?.select(), 50);
                        }}
                        title="Clique para editar o tema"
                      >
                        {temaValue}
                        <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </span>
                    )}
                    <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                      Session
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {guildName}
                  </p>
                  
                  {/* Stats row */}
                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground pt-1">
                    <span className="flex items-center gap-1.5">
                      <Users className="h-4 w-4" />
                      {participantCount} participant{participantCount !== 1 ? 's' : ''}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-4 w-4" />
                      {formatDuration(mixedRecording?.duration_seconds || totalDuration / (recordings.length || 1))}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <HardDrive className="h-4 w-4" />
                      {formatFileSize(totalSize)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Calendar className="h-4 w-4" />
                      {createdAt && formatDate(createdAt)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {recordings.length} track{recordings.length !== 1 ? 's' : ''}
                </Badge>
                {isExpanded ? (
                  <ChevronUp className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
            </Button>
          </CollapsibleTrigger>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="pt-2 space-y-4">
            {/* Mixed track (featured) */}
            {mixedRecording && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
                  <Users className="h-3 w-3" />
                  <span>Mixed Track</span>
                </div>
                <RecordingCard recording={mixedRecording} />
              </div>
            )}

            {/* Individual tracks */}
            {individualRecordings.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
                  <User className="h-3 w-3" />
                  <span>Individual Tracks ({individualRecordings.length})</span>
                </div>
                <div className="space-y-4 pl-4 border-l-2 border-purple-500/30">
                  {individualRecordings.map((recording) => (
                    <div key={recording.id} className="relative">
                      {/* Speaker label - styled like Mixed Track */}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider mb-2">
                        <User className="h-3 w-3 text-purple-400" />
                        <span className="text-purple-400 font-medium">
                          {(recording.metadata as any)?.speaker_username || recording.discord_username || 'Unknown'}
                        </span>
                      </div>
                      <RecordingCard recording={recording} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
