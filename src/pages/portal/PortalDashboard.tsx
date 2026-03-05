import { useCampaigns } from "@/hooks/useCampaigns"; 
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { Calendar, Clock, Mic2, ArrowRight, Layers, Bell, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import KGenButton from "@/components/portal/KGenButton";
import { TASK_TYPE_LABELS } from "@/lib/campaignTypes";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

function isWaitlist(c: any) {
  return c.campaign_status === "waiting_list" || (!!c.start_date && new Date(`${c.start_date}T00:00:00`) > new Date());
}

function CampaignCard({ campaign, isOnWaitlist }: { campaign: any; isOnWaitlist?: boolean }) {
  const enabledTaskSets = campaign.task_sets?.filter((ts: any) => ts.enabled) || [];
  const waitlist = isWaitlist(campaign);
  return (
    <div className="group transition-colors" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
      {enabledTaskSets.length > 0 && (
        <div className="font-mono text-sm uppercase tracking-widest font-bold flex items-center gap-1 px-4 py-3" style={{ color: "var(--portal-text-muted)", borderBottom: "1px solid var(--portal-border)" }}>
          <Layers className="h-2.5 w-2.5" />
          {enabledTaskSets.map((ts: any) => TASK_TYPE_LABELS[ts.task_type] || ts.task_type).join(" · ")}
        </div>
      )}
      <div className="p-5 pt-2 space-y-3" style={{ borderBottom: "1px solid var(--portal-border)" }}>
        <div className="flex items-start justify-between">
          <h3 className="font-mono text-lg font-bold uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>{campaign.name}</h3>
          {campaign.client && (
            <span className="font-mono text-xs font-extrabold uppercase tracking-widest px-2 py-1" style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}>{campaign.client.name}</span>
          )}
        </div>
        {campaign.description && <p className="font-mono text-sm line-clamp-2" style={{ color: "var(--portal-text-muted)" }}>{campaign.description}</p>}
      </div>
      <div className="p-5 space-y-3">
        <div className="flex flex-wrap gap-3 font-mono text-sm" style={{ color: "var(--portal-text-muted)" }}>
          {campaign.start_date && (
            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{format(new Date(campaign.start_date), "dd MMM yyyy", { locale: ptBR })}</span>
          )}
          {campaign.target_hours && (
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{campaign.target_hours}h meta</span>
          )}
        </div>
        {campaign.language_variants && campaign.language_variants.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {campaign.language_variants.map((v: any) => (
              <span key={v.variant_id} className="font-mono text-xs px-2 py-0.5" style={{ background: "hsl(0 0% 15%)", border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}>{v.label}</span>
            ))}
          </div>
        )}
      </div>
      <div className="p-5" style={{ borderTop: "1px solid var(--portal-border)" }}>
        <Link to={`/campaign/${campaign.id}`}>
          <KGenButton className="w-full" size="sm" scrambleText={waitlist ? "WAITING LIST" : "INICIAR"} icon={waitlist ? <Bell className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />} />
        </Link>
      </div>
    </div>
  );
}

export default function PortalDashboard() {
  const { data: campaigns, isLoading } = useCampaigns();

  const allVisible = campaigns?.filter(c => c.is_active) || [];
  
  const readyNow = allVisible
    .filter(c => !isWaitlist(c))
    .sort((a, b) => {
      const da = a.start_date ? new Date(a.start_date).getTime() : 0;
      const db = b.start_date ? new Date(b.start_date).getTime() : 0;
      return da - db;
    });

  const waitlistCampaigns = allVisible
    .filter(c => isWaitlist(c))
    .sort((a, b) => {
      const da = a.start_date ? new Date(a.start_date).getTime() : Infinity;
      const db = b.start_date ? new Date(b.start_date).getTime() : Infinity;
      return da - db;
    });

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
          <span className="font-mono text-sm tracking-[0.3em] uppercase" style={{ color: "var(--portal-accent)" }}>Oportunidades</span>
        </div>
        <h1 className="font-mono text-3xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>Oportunidades Disponíveis</h1>
        <p className="font-mono text-base mt-2" style={{ color: "var(--portal-text-muted)" }}>Selecione uma oportunidade para começar</p>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-48" style={{ background: "var(--portal-card-bg)" }} />)}
        </div>
      )}

      {!isLoading && allVisible.length === 0 && (
        <div className="text-center py-16" style={{ border: "1px solid var(--portal-border)" }}>
          <Mic2 className="h-12 w-12 mx-auto mb-4" style={{ color: "var(--portal-text-muted)" }} />
          <h3 className="font-mono text-xl font-bold uppercase" style={{ color: "var(--portal-text)" }}>Nenhuma campanha disponível</h3>
          <p className="font-mono text-base mt-1" style={{ color: "var(--portal-text-muted)" }}>Aguarde novas campanhas serem publicadas.</p>
        </div>
      )}

      {/* Active campaigns */}
      {readyNow.length > 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
            {readyNow.map(c => <CampaignCard key={c.id} campaign={c} />)}
          </div>
        </div>
      )}

      {/* Waiting list campaigns */}
      {waitlistCampaigns.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Bell className="h-4 w-4" style={{ color: "var(--portal-text-muted)" }} />
            <h2 className="font-mono text-lg font-bold uppercase tracking-tight" style={{ color: "var(--portal-text-muted)" }}>Em breve</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
            {waitlistCampaigns.map(c => <CampaignCard key={c.id} campaign={c} />)}
          </div>
        </div>
      )}
    </div>
  );
}
