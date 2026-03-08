import { useParams, useNavigate } from "react-router-dom";
import { useCampaign } from "@/hooks/useCampaigns";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  ArrowLeft, Clock, FileText, Loader2,
  Layers, Globe2, Languages, Coins, ShieldCheck, CheckCircle2, XCircle,
  Users, BookOpen, Bell, CalendarClock, Wrench, icons, Share2,
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import KGenButton from "@/components/portal/KGenButton";
import { TASK_TYPE_LABELS } from "@/lib/campaignTypes";
import type { HardwareCatalogItem } from "@/lib/campaignTypes";
import { useTranslation } from "react-i18next";
import { useCampaignTranslation } from "@/hooks/useCampaignTranslation";

function toPascalCase(str: string): string {
  return str.split("-").map(s => s.charAt(0).toUpperCase() + s.slice(1)).join("");
}

function resolvePlace(code: string, lang: string): string {
  try {
    const locale = lang === "es" ? "es" : lang === "en" ? "en" : "pt-BR";
    const names = new Intl.DisplayNames([locale], { type: "region" });
    if (/^[A-Z]{2}$/.test(code)) return names.of(code) || code;
  } catch {}
  return code;
}

function getEmbedUrl(url: string): string {
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  return url;
}

const HARDWARE_LOCALIZATION_MAP: Record<string, Record<string, string>> = {
  es: {
    "mobile phone": "Teléfono móvil",
    "cell phone": "Teléfono móvil",
    cellphone: "Teléfono móvil",
    smartphone: "Teléfono móvil",
    phone: "Teléfono",
    headset: "Auriculares",
    headphones: "Auriculares",
    earphones: "Auriculares",
    microphone: "Micrófono",
    mic: "Micrófono",
    laptop: "Portátil",
    notebook: "Portátil",
    desktop: "Computadora de escritorio",
    "desktop pc": "Computadora de escritorio",
    computer: "Computadora",
    tablet: "Tableta",
    webcam: "Cámara web",
  },
  pt: {
    "mobile phone": "Celular",
    "cell phone": "Celular",
    cellphone: "Celular",
    smartphone: "Celular",
    phone: "Telefone",
    headset: "Headset",
    headphones: "Fones de ouvido",
    earphones: "Fones de ouvido",
    microphone: "Microfone",
    mic: "Microfone",
    laptop: "Notebook",
    notebook: "Notebook",
    desktop: "Computador de mesa",
    "desktop pc": "Computador de mesa",
    computer: "Computador",
    tablet: "Tablet",
    webcam: "Webcam",
  },
};

function normalizeHardwareKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getLocalizedHardwareName(original: string, translated: string | undefined, lang: string): string {
  const normalizedOriginal = normalizeHardwareKey(original || "");
  const normalizedTranslated = normalizeHardwareKey(translated || "");
  const dict = HARDWARE_LOCALIZATION_MAP[lang] || {};

  if (translated && normalizedTranslated && normalizedTranslated !== normalizedOriginal) {
    return translated;
  }

  return dict[normalizedOriginal] || translated || original;
}



function useWaitlistStatus(campaignId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ["campaign_waitlist", campaignId, userId],
    queryFn: async () => {
      if (!campaignId || !userId) return null;
      const { data, error } = await supabase
        .from("campaign_waitlist")
        .select("id")
        .eq("campaign_id", campaignId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!campaignId && !!userId,
  });
}

export default function PortalCampaign() {
  const { id } = useParams<{ id: string }>();
  const { data: campaign, isLoading } = useCampaign(id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const { t, i18n } = useTranslation();
  const [hardwareCatalog, setHardwareCatalog] = useState<HardwareCatalogItem[]>([]);
  const { translated: tr, isTranslating } = useCampaignTranslation(campaign);

  // Load hardware catalog
  useEffect(() => {
    supabase.from("hardware_catalog").select("*").order("name").then(({ data }) => {
      if (data) setHardwareCatalog(data as any);
    });
  }, []);

  const { data: waitlistEntry, isLoading: waitlistLoading } = useWaitlistStatus(id, user?.id);

  // Check if user already participates
  const { data: participationEntry } = useQuery({
    queryKey: ["campaign_participant", id, user?.id],
    queryFn: async () => {
      if (!id || !user?.id) return null;
      const { data, error } = await supabase
        .from("campaign_participants")
        .select("id")
        .eq("campaign_id", id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id && !!user?.id,
  });

  const isParticipant = !!participationEntry;

  // Check if campaign hasn't started yet (by date or by status)
  const isBeforeStartDate = useMemo(() => {
    if (campaign?.campaign_status === "waiting_list") return true;
    if (!campaign?.start_date) return false;
    const startDate = new Date(campaign.start_date + "T00:00:00");
    return startDate > new Date();
  }, [campaign]);

  const isOnWaitlist = !!waitlistEntry;


  const handleJoinWaitlist = async () => {
    if (!user || !campaign) return;
    setCreating(true);
    try {
      const { error } = await supabase
        .from("campaign_waitlist")
        .insert({ campaign_id: campaign.id, user_id: user.id });
      if (error) throw error;
      toast.success("Você entrou na lista de espera!");
      queryClient.invalidateQueries({ queryKey: ["campaign_waitlist", campaign.id, user.id] });
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleLeaveWaitlist = async () => {
    if (!user || !campaign) return;
    setCreating(true);
    try {
      const { error } = await supabase
        .from("campaign_waitlist")
        .delete()
        .eq("campaign_id", campaign.id)
        .eq("user_id", user.id);
      if (error) throw error;
      toast.success("Você saiu da lista de espera.");
      queryClient.invalidateQueries({ queryKey: ["campaign_waitlist", campaign.id, user.id] });
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleParticipate = async () => {
    if (!user || !campaign) return;
    setCreating(true);
    try {
      if (!isParticipant) {
        const { error } = await supabase
          .from("campaign_participants")
          .insert({ campaign_id: campaign.id, user_id: user.id });
        if (error && !error.message.includes("duplicate")) throw error;
        queryClient.invalidateQueries({ queryKey: ["campaign_participant", campaign.id, user.id] });
      }
      navigate(`/campaign/${campaign.id}/task`);
    } catch (err: any) {
      toast.error("Erro ao participar: " + err.message);
    } finally {
      setCreating(false);
    }
  };

  if (isLoading) {
    return <Skeleton className="h-64" style={{ background: "var(--portal-card-bg)" }} />;
  }

  if (!campaign) {
    return (
      <div className="text-center py-16" style={{ border: "1px solid var(--portal-border)" }}>
        <p className="font-mono text-sm" style={{ color: "var(--portal-text-muted)" }}>Campanha não encontrada.</p>
        <button
          onClick={() => navigate("/")}
          className="font-mono text-sm uppercase tracking-widest mt-4 px-4 py-2 transition-colors"
          style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}
        >
          Voltar
        </button>
      </div>
    );
  }

  const enabledTaskSets = campaign.task_sets?.filter(ts => ts.enabled) || [];
  
  const geo = campaign.geographic_scope;
  const langVariants = campaign.language_variants || [];
  const rewardCurrency = campaign.reward_config?.currency;
  const adminRules = campaign.administrative_rules;

  // Helper: render a section with border
  const Section = ({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) => (
    <div className="p-6" style={{ borderBottom: "1px solid var(--portal-border)" }}>
      <h3 className="font-mono text-base uppercase tracking-widest mb-4 flex items-center gap-2" style={{ color: "var(--portal-text-muted)" }}>
        <Icon className="h-4.5 w-4.5" />
        {title}
      </h3>
      {children}
    </div>
  );

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Back button */}
      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-2 font-mono text-base uppercase tracking-widest transition-colors"
        style={{ color: "var(--portal-text-muted)" }}
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar
      </button>

      {/* Campaign card */}
      <div style={{ border: "1px solid var(--portal-border)" }}>
        {/* Reward hero block */}
        {campaign.reward_config?.base_rate != null && (
          <div className="px-4 py-3 flex items-center justify-between" style={{ background: "var(--portal-accent)" }}>
            <div className="flex items-center gap-3">
              <Coins className="h-5 w-5" style={{ color: "var(--portal-accent-text)" }} />
              <span className="font-mono text-2xl font-black" style={{ color: "var(--portal-accent-text)" }}>
                {campaign.reward_config.currency === "BRL" ? "R$" : campaign.reward_config.currency === "EUR" ? "€" : "$"}
                {campaign.reward_config.base_rate.toFixed(2)}
                <span className="text-sm font-bold ml-1">
                  {campaign.reward_config.payout_model === "per_accepted_unit" || campaign.reward_config.payout_model === "per_unit" ? "/un" : "/h"}
                </span>
              </span>
              <span className="font-mono text-sm font-bold uppercase tracking-widest" style={{ color: "var(--portal-accent-text)", opacity: 0.8 }}>
                Valor por tarefa
              </span>
            </div>
            <span className="font-mono text-xs font-black uppercase px-2 py-1" style={{ background: "var(--portal-accent-text)", color: "var(--portal-accent)", borderRadius: "2px" }}>
              {(campaign.reward_config as any).payment_type || campaign.reward_config.currency}
            </span>
          </div>
        )}

        {/* Header */}
        <div className="p-6" style={{ borderBottom: "1px solid var(--portal-border)" }}>
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
              <span className="font-mono text-base tracking-[0.3em] uppercase" style={{ color: "var(--portal-accent)" }}>
                Campanha
              </span>
              {enabledTaskSets.length > 0 && (
                <>
                  <span className="font-mono text-base" style={{ color: "var(--portal-text-muted)" }}>›</span>
                  <span className="font-mono text-sm uppercase tracking-wider" style={{ color: "var(--portal-text-muted)" }}>
                    {enabledTaskSets.map(ts => TASK_TYPE_LABELS[ts.task_type] || ts.task_type).join(" · ")}
                  </span>
                </>
              )}
            </div>
            <h1 className="font-mono text-2xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
              {tr?.name || campaign.name}
              {isTranslating && <Loader2 className="inline h-4 w-4 ml-2 animate-spin" style={{ color: "var(--portal-text-muted)" }} />}
            </h1>
          </div>
          {(tr?.description || campaign.description) && (
            <p className="font-mono text-base mt-4 leading-relaxed" style={{ color: "var(--portal-text-muted)" }}>
              {tr?.description || campaign.description}
            </p>
          )}
        </div>




        {/* SECTION 2: Instruções Passo a Passo / Vídeo / PDF */}
        {campaign.instructions && (campaign.instructions.instructions_title || (campaign.instructions.instructions_steps && campaign.instructions.instructions_steps.length > 0) || campaign.instructions.instructions_summary || campaign.instructions.video_url || campaign.instructions.pdf_file_url) && (
          <Section title="Instruções" icon={BookOpen}>
            <div className="space-y-3 p-4" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
              {(tr?.instructions_title || campaign.instructions.instructions_title) && (
                <p className="font-mono text-base font-bold uppercase" style={{ color: "var(--portal-text)" }}>
                  {tr?.instructions_title || campaign.instructions.instructions_title}
                </p>
              )}
              {campaign.instructions.instructions_steps && campaign.instructions.instructions_steps.length > 0 && (
                <ol className="space-y-2">
                  {((tr?.instructions_steps || campaign.instructions.instructions_steps) as Array<{ title: string; description: string }>).map((step, idx) => (
                    <li key={idx} className="flex gap-3 p-3" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-bg)" }}>
                      <span className="font-mono text-lg font-bold shrink-0" style={{ color: "var(--portal-accent)" }}>{idx + 1}.</span>
                      <div className="space-y-0.5">
                        {step.title && <p className="font-mono text-base font-semibold" style={{ color: "var(--portal-text)" }}>{step.title}</p>}
                        {step.description && <p className="font-mono text-sm leading-relaxed" style={{ color: "var(--portal-text-muted)" }}>{step.description}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {(tr?.instructions_summary || campaign.instructions.instructions_summary) && (
                <p className="font-mono text-base leading-relaxed whitespace-pre-line" style={{ color: "var(--portal-text-muted)" }}>
                  {tr?.instructions_summary || campaign.instructions.instructions_summary}
                </p>
              )}
              {campaign.instructions.video_url && (
                <div className="space-y-2">
                  <span className="font-mono text-sm uppercase tracking-widest flex items-center gap-1" style={{ color: "var(--portal-text-muted)" }}>
                    Vídeo de Instrução
                  </span>
                  <div className="aspect-video overflow-hidden" style={{ border: "1px solid var(--portal-border)" }}>
                    <iframe
                      src={getEmbedUrl(campaign.instructions.video_url)}
                      className="w-full h-full"
                      allowFullScreen
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    />
                  </div>
                </div>
              )}
              {campaign.instructions.pdf_file_url && (
                <div className="space-y-2">
                  <span className="font-mono text-sm uppercase tracking-widest flex items-center gap-1" style={{ color: "var(--portal-text-muted)" }}>
                    <FileText className="h-4 w-4" /> Instruções Completas (PDF)
                  </span>
                  <a
                    href={campaign.instructions.pdf_file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-3 font-mono text-base transition-colors hover:opacity-80"
                    style={{ border: "1px solid var(--portal-border)", background: "var(--portal-bg)", color: "var(--portal-accent)" }}
                  >
                    <FileText className="h-4 w-4" />
                    Baixar PDF com instruções detalhadas
                  </a>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* SECTION 3: O que Fazer */}
        {campaign.instructions?.prompt_do && campaign.instructions.prompt_do.length > 0 && (
          <Section title={t("campaign.whatToDo")} icon={CheckCircle2}>
            <div className="space-y-1 p-4" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
              <ul className="space-y-1.5">
                {(tr?.prompt_do || campaign.instructions.prompt_do).map((item: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 font-mono text-base" style={{ color: "var(--portal-text)" }}>
                    <CheckCircle2 className="h-4.5 w-4.5 mt-0.5 shrink-0" style={{ color: "var(--portal-accent)" }} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </Section>
        )}

        {/* SECTION 4: O que NÃO Fazer */}
        {campaign.instructions?.prompt_dont && campaign.instructions.prompt_dont.length > 0 && (
          <Section title={t("campaign.whatNotToDo")} icon={XCircle}>
            <div className="space-y-1 p-4" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
              <ul className="space-y-1.5">
                {(tr?.prompt_dont || campaign.instructions.prompt_dont).map((item: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 font-mono text-base" style={{ color: "var(--portal-text)" }}>
                    <XCircle className="h-4.5 w-4.5 mt-0.5 shrink-0" style={{ color: "hsl(0 72% 51%)" }} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </Section>
        )}

        {/* SECTION: Hardware Necessário */}
        {campaign.instructions?.required_hardware && campaign.instructions.required_hardware.length > 0 && (
          <Section title="Hardware Necessário" icon={Wrench}>
            <div className="flex flex-wrap gap-3">
              {campaign.instructions.required_hardware.map((hwName: string, i: number) => {
                const catalogItem = hardwareCatalog.find(h => h.name.toLowerCase() === hwName.toLowerCase());
                const pascalName = catalogItem ? toPascalCase(catalogItem.icon_name) : null;
                const LucideIcon = pascalName ? (icons as any)[pascalName] : null;
                return (
                  <div
                    key={i}
                    className="flex flex-col items-center gap-1.5 p-3 min-w-[72px]"
                    style={{ border: "1px solid var(--portal-border)", background: "var(--portal-bg)" }}
                  >
                    {LucideIcon ? (
                      <LucideIcon className="h-6 w-6" style={{ color: "var(--portal-accent)" }} />
                    ) : (
                      <Wrench className="h-6 w-6" style={{ color: "var(--portal-text-muted)" }} />
                    )}
                    <span className="font-mono text-sm text-center leading-tight" style={{ color: "var(--portal-text)" }}>
                      {getLocalizedHardwareName(hwName, tr?.required_hardware?.[i], i18n.language?.substring(0, 2) || "pt")}
                    </span>
                  </div>
                );
              })}
            </div>
          </Section>
        )}



        {/* Geographic restrictions (languages + countries) */}
        {(langVariants.length > 0 || (geo && geo.restriction_mode)) && (
          <Section title="Restrições Geográficas" icon={Globe2}>
            <div className="space-y-4">
              {/* Languages */}
              {langVariants.length > 0 && (
                <div className="space-y-2">
                  <span className="font-mono text-sm uppercase tracking-widest flex items-center gap-1.5" style={{ color: "var(--portal-text-muted)" }}>
                    <Languages className="h-4 w-4" />
                    Idioma{langVariants.length > 1 ? "s" : ""}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {langVariants.map(v => (
                      <span
                        key={v.variant_id}
                        className="font-mono text-base px-2.5 py-1 flex items-center gap-2"
                        style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)", color: "var(--portal-text)" }}
                      >
                        {v.label}
                        {v.is_primary && (
                          <span className="text-sm uppercase tracking-widest px-1.5 py-0.5" style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}>
                            Principal
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {/* Countries */}
              {geo && geo.restriction_mode && (
                <div className="space-y-2">
                  <span className="font-mono text-sm uppercase tracking-widest flex items-center gap-1.5" style={{ color: "var(--portal-text-muted)" }}>
                    <Users className="h-4 w-4" />
                    Participantes {geo.restriction_mode === "include" ? "apenas" : "exceto"}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {[...(geo.continents || []), ...(geo.countries || []), ...(geo.regions || []), ...(geo.states || []), ...(geo.cities || [])].map((place, i) => (
                      <span key={i} className="font-mono text-base px-2.5 py-1" style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text)" }}>
                        {resolvePlace(place, i18n.language?.substring(0, 2) || "pt")}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Administrative rules */}
        {adminRules && (
          <Section title="Regras" icon={ShieldCheck}>
            <div className="grid grid-cols-2 gap-3">
              {adminRules.max_hours_per_user != null && (
                <RuleBadge icon={Clock} label="Máx. horas/usuário" value={`${adminRules.max_hours_per_user}h`} />
              )}
              {adminRules.max_hours_per_partner_per_user != null && (
                <RuleBadge icon={Clock} label="Máx. horas/parceiro/usuário" value={`${adminRules.max_hours_per_partner_per_user}h`} />
              )}
              {adminRules.max_sessions_per_user != null && (
                <RuleBadge icon={Users} label="Máx. sessões/usuário" value={String(adminRules.max_sessions_per_user)} />
              )}
              {adminRules.min_acceptance_rate != null && (
                <RuleBadge icon={ShieldCheck} label="Taxa mín. aceitação" value={`${adminRules.min_acceptance_rate}${adminRules.min_acceptance_rate_unit === "percent" ? "%" : ""}`} />
              )}
              {adminRules.min_participants_per_session != null && (
                <RuleBadge icon={Users} label="Mín. participantes" value={String(adminRules.min_participants_per_session)} />
              )}
              {adminRules.max_participants_per_session != null && (
                <RuleBadge icon={Users} label="Máx. participantes" value={String(adminRules.max_participants_per_session)} />
              )}
            </div>
          </Section>
        )}

        {/* Referral distribution */}
        {campaign.referral_config && campaign.reward_config?.base_rate != null && (() => {
          const rc = campaign.referral_config;
          const baseRate = campaign.reward_config!.base_rate!;
          const pool = rc.pool_fixed_amount != null ? rc.pool_fixed_amount : baseRate * (rc.pool_percent / 100);
          const levels: number[] = [];
          let remaining = pool;
          for (let i = 0; i < rc.max_levels; i++) {
            const val = remaining * rc.cascade_keep_ratio;
            levels.push(val);
            remaining -= val;
          }
          const currency = campaign.reward_config!.currency || "USD";
          const payoutModel = campaign.reward_config!.payout_model || "per_hour";
          const unitLabel = payoutModel === "per_unit" ? "/un" : "/h";
          return (
            <Section title={t("campaign.referralDistribution") || "Distribuição Indicação"} icon={Share2}>
              <div className="space-y-3">
                <p className="font-mono text-base" style={{ color: "var(--portal-text-muted)" }}>
                  {t("campaign.referralDistributionDesc") || "Valores pagos por indicação para cada nível da sua rede."}
                </p>
                <div className="grid grid-cols-5 gap-2">
                  {levels.map((val, i) => (
                    <div
                      key={i}
                      className="flex flex-col items-center gap-1.5 p-3"
                      style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}
                    >
                      <span className="font-mono text-sm uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
                        {t("campaign.level") || "Nível"} {i + 1}
                      </span>
                      <span className="font-mono text-base font-bold" style={{ color: "var(--portal-accent)" }}>
                        {currency === "BRL" ? "R$" : "$"}{val.toFixed(2)}
                      </span>
                      <span className="font-mono text-[13px]" style={{ color: "var(--portal-text-muted)" }}>
                        {unitLabel}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Section>
          );
        })()}

        {/* Action section */}
        {isBeforeStartDate ? (
          /* Campaign hasn't started — show waitlist */
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-2 p-4" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
              <CalendarClock className="h-4 w-4 shrink-0" style={{ color: "var(--portal-text-muted)" }} />
              <p className="font-mono text-base" style={{ color: "var(--portal-text-muted)" }}>
                Esta campanha inicia em{" "}
                <span className="font-bold" style={{ color: "var(--portal-text)" }}>
                  {new Date(campaign.start_date!).toLocaleDateString("pt-BR")}
                </span>
              </p>
            </div>
            {isOnWaitlist ? (
              <KGenButton
                onClick={handleLeaveWaitlist}
                disabled={creating}
                className="w-full"
                size="default"
                scrambleText={creating ? "SAINDO..." : "SAIR DA LISTA DE ESPERA"}
                icon={creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
              />
            ) : (
              <KGenButton
                onClick={handleJoinWaitlist}
                disabled={creating || !user}
                className="w-full"
                size="default"
                scrambleText={creating ? "ENTRANDO..." : "ENTRAR NA LISTA DE ESPERA"}
                icon={creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
              />
            )}
          </div>
        ) : (
          /* Campaign active — show participate / continue */
          <div className="p-6">
            <KGenButton
              onClick={isParticipant ? () => navigate(`/campaign/${campaign.id}/task`) : handleParticipate}
              disabled={creating || !user}
              className="w-full"
              size="default"
              scrambleText={creating ? "ENTRANDO..." : isParticipant ? "CONTINUAR TAREFAS" : "PARTICIPAR"}
              icon={creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function RuleBadge({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 p-3 font-mono text-base" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--portal-text-muted)" }} />
      <div className="flex flex-col">
        <span style={{ color: "var(--portal-text-muted)" }}>{label}</span>
        <span className="font-bold" style={{ color: "var(--portal-text)" }}>{value}</span>
      </div>
    </div>
  );
}
