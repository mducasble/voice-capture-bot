import { useMemo } from "react";
import { Mic2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SessionGroup } from "@/components/SessionGroup";
import { AudioUpload } from "@/components/AudioUpload";
import { MultiSpeakerUpload } from "@/components/MultiSpeakerUpload";
import { useRecordings, type Recording } from "@/hooks/useRecordings";
import { Skeleton } from "@/components/ui/skeleton";

const Index = () => {
  const { data: recordings, isLoading, error } = useRecordings();

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
    <div className="space-y-8">
      {/* Header */}
      <section className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Gravações</h1>
          <p className="text-sm text-muted-foreground">Gerenciar uploads e sessões de áudio</p>
        </div>
      </section>

      {/* Upload Section */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AudioUpload />
        <MultiSpeakerUpload />
      </section>

      <main className="space-y-8">

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
    </div>
  );
};

export default Index;
