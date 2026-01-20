import { Mic2, Clock, HardDrive, Server, Radio, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RecordingCard } from "@/components/RecordingCard";
import { StatsCard } from "@/components/StatsCard";
import { StorageStatsCard } from "@/components/StorageStatsCard";
import { AudioSpecBadge } from "@/components/AudioSpecBadge";
import { AudioUpload } from "@/components/AudioUpload";
import { useRecordings, useRecordingStats } from "@/hooks/useRecordings";
import { Skeleton } from "@/components/ui/skeleton";

const Index = () => {
  const { data: recordings, isLoading, error } = useRecordings();
  const stats = useRecordingStats(recordings);

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
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AudioUpload />
          <StorageStatsCard stats={stats.storageStats} />
        </section>

        {/* Recordings List */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold text-foreground">
              Recent Recordings
            </h3>
            {recordings && recordings.length > 0 && (
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

          {!isLoading && recordings && recordings.length > 0 && (
            <div className="space-y-4">
              {recordings.map((recording) => (
                <RecordingCard key={recording.id} recording={recording} />
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
