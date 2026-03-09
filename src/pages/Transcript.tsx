import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, FileText, Mic2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RecordingCard } from "@/components/RecordingCard";
import { SessionGroup } from "@/components/SessionGroup";
import { AudioUpload } from "@/components/AudioUpload";
import { CampaignSelector } from "@/components/CampaignSelector";
import { useRecordings, type Recording } from "@/hooks/useRecordings";
import { Skeleton } from "@/components/ui/skeleton";

const Transcript = () => {
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const { data: allRecordings, isLoading, error } = useRecordings();

  // Filter only transcription-only recordings
  const recordings = useMemo(
    () => allRecordings?.filter((r) => r.quality_status === "transcription-only") ?? [],
    [allRecordings]
  );

  // Group by session_id (same logic as Index)
  const groupedSessions = useMemo(() => {
    if (!recordings.length) return [];

    const sessionMap = new Map<string, Recording[]>();
    const standalone: Recording[] = [];

    recordings.forEach((rec) => {
      if (rec.session_id) {
        const arr = sessionMap.get(rec.session_id) || [];
        arr.push(rec);
        sessionMap.set(rec.session_id, arr);
      } else {
        standalone.push(rec);
      }
    });

    const sessions = Array.from(sessionMap.entries()).map(([id, recs]) => ({
      sessionId: id,
      recordings: recs.sort((a, b) => {
        if (a.recording_type === "mixed" && b.recording_type !== "mixed") return -1;
        if (b.recording_type === "mixed" && a.recording_type !== "mixed") return 1;
        return (a.discord_username || "").localeCompare(b.discord_username || "");
      }),
      latestDate: Math.max(...recs.map((r) => new Date(r.created_at).getTime())),
    }));

    standalone.forEach((rec) => {
      sessions.push({
        sessionId: rec.id,
        recordings: [rec],
        latestDate: new Date(rec.created_at).getTime(),
      });
    });

    return sessions.sort((a, b) => b.latestDate - a.latestDate);
  }, [recordings]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="p-2 rounded-lg bg-primary/10">
              <FileText className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Standalone Transcription</h1>
              <p className="text-sm text-muted-foreground">
                Upload and transcribe individual audio files
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container py-8 space-y-8">
        {/* Upload */}
        <section>
          <AudioUpload transcriptionOnly />
        </section>

        {/* Recordings List */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold text-foreground">Transcriptions</h3>
            {recordings.length > 0 && (
              <span className="text-sm text-muted-foreground">
                {recordings.length} recording{recordings.length !== 1 ? "s" : ""}
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
              Failed to load recordings.
            </div>
          )}

          {!isLoading && !error && recordings.length === 0 && (
            <div className="text-center py-16 space-y-4 glass-card rounded-lg">
              <div className="p-4 rounded-full bg-muted/50 inline-block">
                <Mic2 className="h-10 w-10 text-muted-foreground" />
              </div>
              <div>
                <h4 className="text-lg font-medium text-foreground">
                  No transcriptions yet
                </h4>
                <p className="text-muted-foreground max-w-md mx-auto mt-2">
                  Upload an audio file above to start transcribing.
                </p>
              </div>
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

export default Transcript;
