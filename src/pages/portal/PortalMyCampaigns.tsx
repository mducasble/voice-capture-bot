import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { FolderOpen, ArrowRight } from "lucide-react";
import KGenButton from "@/components/portal/KGenButton";

export default function PortalMyCampaigns() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: participations, isLoading } = useQuery({
    queryKey: ["my_campaigns", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("campaign_participants")
        .select("campaign_id, joined_at, status, campaigns:campaign_id(id, name, description, campaign_status, start_date, end_date)")
        .eq("user_id", user.id)
        .order("joined_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-24" style={{ background: "var(--portal-input-bg)" }} />)}
      </div>
    );
  }

  if (!participations || participations.length === 0) {
    return (
      <div className="text-center py-16" style={{ border: "1px solid var(--portal-border)" }}>
        <FolderOpen className="h-8 w-8 mx-auto mb-4" style={{ color: "var(--portal-text-muted)" }} />
        <p className="font-mono text-sm" style={{ color: "var(--portal-text-muted)" }}>
          Você ainda não participa de nenhuma campanha.
        </p>
        <button
          onClick={() => navigate("/")}
          className="font-mono text-xs uppercase tracking-widest mt-4 px-4 py-2 transition-colors"
          style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}
        >
          Explorar Campanhas
        </button>
      </div>
    );
  }

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
          return (
            <button
              key={p.campaign_id}
              onClick={() => navigate(`/campaign/${campaign.id}/task`)}
              className="w-full text-left p-5 flex items-center justify-between gap-4 transition-colors group"
              style={{ border: "1px solid var(--portal-border)", background: "var(--portal-input-bg)" }}
            >
              <div className="min-w-0">
                <h2 className="font-mono text-sm font-bold uppercase tracking-tight truncate" style={{ color: "var(--portal-text)" }}>
                  {campaign.name}
                </h2>
                {campaign.description && (
                  <p className="font-mono text-xs mt-1 truncate" style={{ color: "var(--portal-text-muted)" }}>
                    {campaign.description}
                  </p>
                )}
                <span className="font-mono text-[10px] uppercase tracking-widest mt-2 inline-block" style={{ color: "var(--portal-text-muted)" }}>
                  Desde {new Date(p.joined_at).toLocaleDateString("pt-BR")}
                </span>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0" style={{ color: "var(--portal-text-muted)" }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
