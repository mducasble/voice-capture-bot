import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Database, FileAudio, FileArchive } from "lucide-react";

interface StorageStats {
  totalBytes: number;
  compressedBytes: number;
  recordingCount: number;
}

interface StorageStatsCardProps {
  stats: StorageStats;
  storageLimit?: number; // in bytes, default 1GB for free tier
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatPercentage(used: number, total: number): number {
  if (total === 0) return 0;
  return Math.min(100, (used / total) * 100);
}

export function StorageStatsCard({ 
  stats, 
  storageLimit = 1024 * 1024 * 1024 // 1GB default
}: StorageStatsCardProps) {
  const usagePercentage = formatPercentage(stats.totalBytes, storageLimit);
  const savings = stats.totalBytes > 0 && stats.compressedBytes > 0
    ? ((stats.totalBytes - stats.compressedBytes) / stats.totalBytes * 100).toFixed(0)
    : 0;

  return (
    <Card className="glass-card col-span-full lg:col-span-2">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          Armazenamento
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Uso total</span>
            <span className="font-medium text-foreground">
              {formatBytes(stats.totalBytes)} / {formatBytes(storageLimit)}
            </span>
          </div>
          <Progress 
            value={usagePercentage} 
            className="h-2"
          />
          <p className="text-xs text-muted-foreground">
            {usagePercentage.toFixed(1)}% usado • {formatBytes(storageLimit - stats.totalBytes)} disponível
          </p>
        </div>

        {/* Stats breakdown */}
        <div className="grid grid-cols-2 gap-4 pt-2">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
            <FileAudio className="h-8 w-8 text-blue-500" />
            <div>
              <p className="text-xs text-muted-foreground">Originais (WAV)</p>
              <p className="text-lg font-semibold text-foreground">
                {formatBytes(stats.totalBytes)}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
            <FileArchive className="h-8 w-8 text-green-500" />
            <div>
              <p className="text-xs text-muted-foreground">Comprimidos</p>
              <p className="text-lg font-semibold text-foreground">
                {formatBytes(stats.compressedBytes)}
              </p>
              {Number(savings) > 0 && (
                <p className="text-xs text-green-500">-{savings}% economia</p>
              )}
            </div>
          </div>
        </div>

        {/* Additional info */}
        <div className="text-xs text-muted-foreground pt-2 border-t border-border/50">
          <p>
            {stats.recordingCount} gravação{stats.recordingCount !== 1 ? "ões" : ""} • 
            Média: {stats.recordingCount > 0 
              ? formatBytes(stats.totalBytes / stats.recordingCount) 
              : "0 B"}/arquivo
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
