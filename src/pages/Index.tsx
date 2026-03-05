import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Mic2, Clock, HardDrive, Server, Radio, ExternalLink, FolderOpen, FileCheck, FileText, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RecordingCard } from "@/components/RecordingCard";
import { SessionGroup } from "@/components/SessionGroup";
import { StatsCard } from "@/components/StatsCard";
import { StorageStatsCard } from "@/components/StorageStatsCard";
import { AudioSpecBadge } from "@/components/AudioSpecBadge";
import { AudioUpload } from "@/components/AudioUpload";
import { MultiSpeakerUpload } from "@/components/MultiSpeakerUpload";
import { useRecordings, useRecordingStats, type Recording } from "@/hooks/useRecordings";
import { Skeleton } from "@/components/ui/skeleton";

const Index = () => {
  const { data: recordings, isLoading, error } = useRecordings();
  const stats = useRecordingStats(recordings);

  // Group recordings by session_id
  const groupedSessions = useMemo(() => {
    if (!recordings) return [];
    
    const sessionMap = new Map<string, Recording[]>();
    const standaloneRecordings: Recording[] = [];
    
    recordings.forEach(recording => {
      if (recording.session_id) {
        const existing = sessionMap.get(recording.session_id) || [];
        existing.push(recording);
        sessionMap.set(recording.session_id, existing);
      } else {
        standaloneRecordings.push(recording);
      }
    });
    
    // Convert to array and sort by most recent recording in each session
    const sessions = Array.from(sessionMap.entries()).map(([sessionId, recs]) => ({
      sessionId,
      recordings: recs.sort((a, b) => {
        // Mixed first, then by username
        if (a.recording_type === 'mixed' && b.recording_type !== 'mixed') return -1;
        if (b.recording_type === 'mixed' && a.recording_type !== 'mixed') return 1;
        return (a.discord_username || '').localeCompare(b.discord_username || '');
      }),
      latestDate: Math.max(...recs.map(r => new Date(r.created_at).getTime()))
    }));
    
    // Add standalone recordings as single-item sessions
    standaloneRecordings.forEach(rec => {
      sessions.push({
        sessionId: rec.id, // Use recording id as session id for standalone
        recordings: [rec],
        latestDate: new Date(rec.created_at).getTime()
      });
    });
    
    // Sort by latest date descending
    return sessions.sort((a, b) => b.latestDate - a.latestDate);
  }, [recordings]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Radio className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Voice Recorder</h1>
              <p className="text-sm text-muted-foreground">Discord Audio Capture</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="default" asChild>
              <Link to="/admin/rooms" className="flex items-center gap-2">
                <Radio className="h-4 w-4" />
                Salas de Áudio
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/admin/campaigns" className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4" />
                Campanhas
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/admin/review" className="flex items-center gap-2">
                <FileCheck className="h-4 w-4" />
                Revisão
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/admin/review-queue" className="flex items-center gap-2">
                <ListChecks className="h-4 w-4" />
                Fila de Revisão
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/admin/transcription" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Transcrição
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <a
                href="https://discord.com/developers/applications"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2"
              >
                Discord Portal
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-8 space-y-8">
        {/* Hero Section */}
        <section className="text-center space-y-4 py-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
            </span>
            High-Quality Voice Capture
          </div>
          <h2 className="text-4xl font-bold text-foreground">
            Professional Audio Recording
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Capture Discord voice channels with broadcast-quality audio specifications
          </p>
          <div className="flex justify-center pt-2">
            <AudioSpecBadge />
          </div>
        </section>

        {/* Stats Grid */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard
            title="Total Recordings"
            value={stats.totalRecordings}
            subtitle="All time"
            icon={Mic2}
          />
          <StatsCard
            title="Total Duration"
            value={stats.totalDuration}
            subtitle="Hours recorded"
            icon={Clock}
          />
          <StatsCard
            title="Storage Used"
            value={stats.totalSize}
            subtitle="Uncompressed WAV"
            icon={HardDrive}
          />
          <StatsCard
            title="Servers"
            value={stats.uniqueServers}
            subtitle="Connected guilds"
            icon={Server}
          />
        </section>

        {/* Upload Section */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <AudioUpload />
          <MultiSpeakerUpload />
          <StorageStatsCard stats={stats.storageStats} />
        </section>

        {/* Recordings List */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold text-foreground">
              Recent Sessions
            </h3>
            {recordings && recordings.length > 0 && (
              <span className="text-sm text-muted-foreground">
                {groupedSessions.length} session{groupedSessions.length !== 1 ? "s" : ""} • {recordings.length} track{recordings.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {isLoading && (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-32 w-full rounded-lg" />
              ))}
            </div>
          )}

          {error && (
            <div className="text-center py-12 text-destructive">
              Failed to load recordings. Please try again later.
            </div>
          )}

          {!isLoading && !error && recordings?.length === 0 && (
            <div className="text-center py-16 space-y-4 glass-card rounded-lg">
              <div className="p-4 rounded-full bg-muted/50 inline-block">
                <Mic2 className="h-10 w-10 text-muted-foreground" />
              </div>
              <div>
                <h4 className="text-lg font-medium text-foreground">
                  No recordings yet
                </h4>
                <p className="text-muted-foreground max-w-md mx-auto mt-2">
                  Set up your Discord bot and use <code className="px-2 py-1 rounded bg-muted text-sm font-mono">/record</code> in a voice channel to start capturing audio.
                </p>
              </div>
              <Button variant="outline" className="mt-4">
                View Setup Guide
              </Button>
            </div>
          )}

          {!isLoading && groupedSessions.length > 0 && (
            <div className="space-y-4">
              {groupedSessions.map((session) => (
                <SessionGroup 
                  key={session.sessionId} 
                  sessionId={session.recordings.length > 1 ? session.sessionId : null}
                  recordings={session.recordings} 
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 py-6 mt-12">
        <div className="container text-center text-sm text-muted-foreground">
          <p>
            Audio captured at 48kHz • 16-bit • Dual Channel • WAV Format
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
