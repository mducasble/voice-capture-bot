import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { FolderOpen, ArrowRight, FileAudio, Clock } from "lucide-react";
import KGenButton from "@/components/portal/KGenButton";

// ... keep existing code (PortalMyCampaigns component start, hooks, loading/empty states)

  const campaignIds = participations?.map((p: any) => p.campaign_id) || [];

  const { data: recordingStats } = useQuery({
    queryKey: ["my_campaign_recordings", campaignIds],
    queryFn: async () => {
      if (!campaignIds.length) return {};
      const { data, error } = await supabase
        .from("voice_recordings")
        .select("campaign_id, id, duration_seconds, recording_type")
        .in("campaign_id", campaignIds);
      if (error) throw error;
      const stats: Record<string, { sessions: number; totalDuration: number }> = {};
      for (const r of data || []) {
        if (!r.campaign_id) continue;
        if (!stats[r.campaign_id]) stats[r.campaign_id] = { sessions: 0, totalDuration: 0 };
        if (r.recording_type === "mixed") {
          stats[r.campaign_id].sessions++;
        }
        stats[r.campaign_id].totalDuration += r.duration_seconds || 0;
      }
      return stats;
    },
    enabled: campaignIds.length > 0,
  });

  // ... keep existing code (loading and empty states)

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m}min`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}min`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
        <h1 className="font-mono text-lg font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
          Minhas Campanhas
        </h1>
      </div>

      <div className="space-y-3">
        {participations.map((p: any) => {
          const campaign = p.campaigns;
          if (!campaign) return null;
          const stats = recordingStats?.[campaign.id];
          return (
            <button
              key={p.campaign_id}
              onClick={() => navigate(`/campaign/${campaign.id}/task`)}
              className="w-full text-left p-5 flex items-center justify-between gap-4 transition-colors group"
              style={{ border: "1px solid var(--portal-border)", background: "var(--portal-input-bg)" }}
            >
              <div className="min-w-0 flex-1">
                <h2 className="font-mono text-sm font-bold uppercase tracking-tight truncate" style={{ color: "var(--portal-text)" }}>
                  {campaign.name}
                </h2>
                {campaign.description && (
                  <p className="font-mono text-xs mt-1 truncate" style={{ color: "var(--portal-text-muted)" }}>
                    {campaign.description}
                  </p>
                )}
                <div className="flex items-center gap-4 mt-2 flex-wrap">
                  <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
                    Desde {new Date(p.joined_at).toLocaleDateString("pt-BR")}
                  </span>
                  {stats && stats.sessions > 0 && (
                    <>
                      <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--portal-accent)" }}>
                        <FileAudio className="h-3 w-3" />
                        {stats.sessions} {stats.sessions === 1 ? "sessão" : "sessões"}
                      </span>
                      <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--portal-accent)" }}>
                        <Clock className="h-3 w-3" />
                        {formatDuration(stats.totalDuration)}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0" style={{ color: "var(--portal-text-muted)" }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
