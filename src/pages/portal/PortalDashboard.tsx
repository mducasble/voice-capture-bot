import { useCampaigns } from "@/hooks/useCampaigns";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { Calendar, Clock, Mic2, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import KGenButton from "@/components/portal/KGenButton";

export default function PortalDashboard() {
  const { data: campaigns, isLoading } = useCampaigns();

  const activeCampaigns = campaigns?.filter(c => c.is_active) || [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
          <span className="font-mono text-xs tracking-[0.3em] uppercase" style={{ color: "var(--portal-accent)" }}>
            Campanhas
          </span>
        </div>
        <h1 className="font-mono text-3xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
          Campanhas Disponíveis
        </h1>
        <p className="font-mono text-sm mt-2" style={{ color: "var(--portal-text-muted)" }}>
          Selecione uma campanha para começar a gravar
        </p>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-48" style={{ background: "var(--portal-input-bg)" }} />
          ))}
        </div>
      )}

      {!isLoading && activeCampaigns.length === 0 && (
        <div className="text-center py-16" style={{ border: "1px solid var(--portal-border)" }}>
          <Mic2 className="h-12 w-12 mx-auto mb-4" style={{ color: "var(--portal-text-muted)" }} />
          <h3 className="font-mono text-lg font-bold uppercase" style={{ color: "var(--portal-text)" }}>
            Nenhuma campanha disponível
          </h3>
          <p className="font-mono text-sm mt-1" style={{ color: "var(--portal-text-muted)" }}>
            Aguarde novas campanhas serem publicadas.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {activeCampaigns.map(campaign => (
          <div
            key={campaign.id}
            className="group transition-colors"
            style={{ border: "1px solid var(--portal-border)", background: "var(--portal-input-bg)" }}
          >
            {/* Card header */}
            <div className="p-5 space-y-3" style={{ borderBottom: "1px solid var(--portal-border)" }}>
              <div className="flex items-start justify-between">
                <h3 className="font-mono text-base font-bold uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
                  {campaign.name}
                </h3>
                {campaign.client && (
                  <span className="font-mono text-[10px] uppercase tracking-widest px-2 py-1" style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}>
                    {campaign.client.name}
                  </span>
                )}
              </div>
              {campaign.description && (
                <p className="font-mono text-xs line-clamp-2" style={{ color: "var(--portal-text-muted)" }}>
                  {campaign.description}
                </p>
              )}
            </div>

            {/* Card body */}
            <div className="p-5 space-y-3">
              <div className="flex flex-wrap gap-3 font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
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

              {campaign.languages && campaign.languages.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {campaign.languages.map(lang => (
                    <span
                      key={lang.id}
                      className="font-mono text-[10px] px-2 py-0.5"
                      style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}
                    >
                      {lang.emoji} {lang.name}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex gap-1 font-mono text-[10px]">
                {[
                  `${campaign.audio_sample_rate || 48000}Hz`,
                  `${campaign.audio_bit_depth || 16}bit`,
                  (campaign.audio_format || "WAV").toUpperCase(),
                ].map(spec => (
                  <span
                    key={spec}
                    className="px-2 py-0.5"
                    style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}
                  >
                    {spec}
                  </span>
                ))}
              </div>

              <Link to={`/portal/campaign/${campaign.id}`}>
                <KGenButton className="w-full mt-2" size="sm" scrambleText="INICIAR GRAVAÇÃO" icon={<ArrowRight className="h-4 w-4" />} />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
