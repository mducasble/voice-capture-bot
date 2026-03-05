import { useCampaigns } from "@/hooks/useCampaigns"; 
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { Calendar, Clock, Mic2, ArrowRight, Layers, Bell } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import KGenButton from "@/components/portal/KGenButton";
import { TASK_TYPE_LABELS } from "@/lib/campaignTypes";

export default function PortalDashboard() {
  const { data: campaigns, isLoading } = useCampaigns();

  const activeCampaigns = campaigns?.filter(c => c.is_active) || [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
          <span className="font-mono text-sm tracking-[0.3em] uppercase" style={{ color: "var(--portal-accent)" }}>
            Oportunidades
          </span>
        </div>
        <h1 className="font-mono text-3xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
          Oportunidades Disponíveis
        </h1>
        <p className="font-mono text-base mt-2" style={{ color: "var(--portal-text-muted)" }}>
          Selecione uma oportunidade para começar
        </p>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-48" style={{ background: "var(--portal-card-bg)" }} />
          ))}
        </div>
      )}

      {!isLoading && activeCampaigns.length === 0 && (
        <div className="text-center py-16" style={{ border: "1px solid var(--portal-border)" }}>
          <Mic2 className="h-12 w-12 mx-auto mb-4" style={{ color: "var(--portal-text-muted)" }} />
          <h3 className="font-mono text-xl font-bold uppercase" style={{ color: "var(--portal-text)" }}>
            Nenhuma campanha disponível
          </h3>
          <p className="font-mono text-base mt-1" style={{ color: "var(--portal-text-muted)" }}>
            Aguarde novas campanhas serem publicadas.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {activeCampaigns.map(campaign => {
          const enabledTaskSets = campaign.task_sets?.filter(ts => ts.enabled) || [];
          const isWaitlistCampaign = campaign.campaign_status === "waiting_list" || (!!campaign.start_date && new Date(`${campaign.start_date}T00:00:00`) > new Date());
          return (
            <div
              key={campaign.id}
              className="group transition-colors"
              style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}
            >
              {/* Task type label at top */}
              {enabledTaskSets.length > 0 && (
                <div
                  className="font-mono text-sm uppercase tracking-widest font-bold flex items-center gap-1 px-4 py-3"
                  style={{ color: "var(--portal-text-muted)", borderBottom: "1px solid var(--portal-border)" }}
                >
                  <Layers className="h-2.5 w-2.5" />
                  {enabledTaskSets.map(ts => TASK_TYPE_LABELS[ts.task_type] || ts.task_type).join(" · ")}
                </div>
              )}

              {/* Card header */}
              <div className="p-5 pt-2 space-y-3" style={{ borderBottom: "1px solid var(--portal-border)" }}>
                <div className="flex items-start justify-between">
                  <h3 className="font-mono text-lg font-bold uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
                    {campaign.name}
                  </h3>
                  {campaign.client && (
                    <span className="font-mono text-xs font-extrabold uppercase tracking-widest px-2 py-1" style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}>
                      {campaign.client.name}
                    </span>
                  )}
                </div>
                {campaign.description && (
                  <p className="font-mono text-sm line-clamp-2" style={{ color: "var(--portal-text-muted)" }}>
                    {campaign.description}
                  </p>
                )}
              </div>

              {/* Card body */}
              <div className="p-5 space-y-3">
                <div className="flex flex-wrap gap-3 font-mono text-sm" style={{ color: "var(--portal-text-muted)" }}>
                  {campaign.start_date && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {format(new Date(campaign.start_date), "dd MMM yyyy", { locale: ptBR })}
                    </span>
                  )}
                  {campaign.target_hours && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {campaign.target_hours}h meta
                    </span>
                  )}
                </div>

                {campaign.language_variants && campaign.language_variants.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {campaign.language_variants.map(v => (
                      <span
                        key={v.variant_id}
                        className="font-mono text-xs px-2 py-0.5"
                        style={{ background: "hsl(0 0% 15%)", border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}
                      >
                        {v.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Card footer */}
              <div className="p-5" style={{ borderTop: "1px solid var(--portal-border)" }}>
                <Link to={`/campaign/${campaign.id}`}>
                  <KGenButton
                    className="w-full"
                    size="sm"
                    scrambleText={isWaitlistCampaign ? "WAITING LIST" : "INICIAR"}
                    icon={isWaitlistCampaign ? <Bell className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                  />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
