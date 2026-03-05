import { useParams, useNavigate } from "react-router-dom";
import { useCampaign } from "@/hooks/useCampaigns";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  ArrowLeft, Radio, Clock, FileText, Loader2, MessageSquare, Timer,
  Layers, Globe2, Languages, Coins, ShieldCheck, CheckCircle2, XCircle,
  Users, BookOpen, Bell, CalendarClock,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import KGenButton from "@/components/portal/KGenButton";
import { TASK_TYPE_LABELS, TASK_TYPE_CATEGORIES } from "@/lib/campaignTypes";

const DURATION_OPTIONS = [10, 15, 20, 25, 30];

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
  const [topic, setTopic] = useState("");
  const [durationMinutes, setDurationMinutes] = useState<number>(10);

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

  // Check if campaign hasn't started yet
  const isBeforeStartDate = useMemo(() => {
    if (!campaign?.start_date) return false;
    return new Date(campaign.start_date) > new Date();
  }, [campaign]);

  const isOnWaitlist = !!waitlistEntry;

  const handleCreateRoom = async () => {
    if (!user || !campaign) return;
    if (!topic.trim()) {
      toast.error("Digite o tema da conversa");
      return;
    }
    setCreating(true);
    try {
      const userName = user.user_metadata?.full_name || user.email || "Usuário";
      const { data: room, error } = await supabase
        .from("rooms")
        .insert({
          creator_name: userName,
          room_name: `${campaign.name} - ${userName}`,
          status: "waiting",
          topic: topic.trim(),
          duration_minutes: durationMinutes,
        })
        .select()
        .single();

      if (error) throw error;
      sessionStorage.setItem(`room_creator_${room.id}`, "true");
      navigate(`/room/${room.id}?campaign=${campaign.id}`);
    } catch (err: any) {
      toast.error("Erro ao criar sala: " + err.message);
    } finally {
      setCreating(false);
    }
  };

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
    return <Skeleton className="h-64" style={{ background: "var(--portal-input-bg)" }} />;
  }

  if (!campaign) {
    return (
      <div className="text-center py-16" style={{ border: "1px solid var(--portal-border)" }}>
        <p className="font-mono text-sm" style={{ color: "var(--portal-text-muted)" }}>Campanha não encontrada.</p>
        <button
          onClick={() => navigate("/")}
          className="font-mono text-xs uppercase tracking-widest mt-4 px-4 py-2 transition-colors"
          style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}
        >
          Voltar
        </button>
      </div>
    );
  }

  const enabledTaskSets = campaign.task_sets?.filter(ts => ts.enabled) || [];
  const allTopics = enabledTaskSets.filter(ts => ts.prompt_topic).map(ts => ts.prompt_topic!);
  const geo = campaign.geographic_scope;
  const langVariants = campaign.language_variants || [];
  const rewardCurrency = campaign.reward_config?.currency;
  const adminRules = campaign.administrative_rules;

  // Helper: render a section with border
  const Section = ({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) => (
    <div className="p-6" style={{ borderBottom: "1px solid var(--portal-border)" }}>
      <h3 className="font-mono text-xs uppercase tracking-widest mb-4 flex items-center gap-2" style={{ color: "var(--portal-text-muted)" }}>
        <Icon className="h-3.5 w-3.5" />
        {title}
      </h3>
      {children}
    </div>
  );

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Back button */}
      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest transition-colors"
        style={{ color: "var(--portal-text-muted)" }}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar
      </button>

      {/* Campaign card */}
      <div style={{ border: "1px solid var(--portal-border)" }}>
        {/* Header */}
        <div className="p-6" style={{ borderBottom: "1px solid var(--portal-border)" }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
                <span className="font-mono text-xs tracking-[0.3em] uppercase" style={{ color: "var(--portal-accent)" }}>
                  Campanha
                </span>
              </div>
              <h1 className="font-mono text-2xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
                {campaign.name}
              </h1>
              {campaign.client && (
                <span className="inline-block font-mono text-[10px] uppercase tracking-widest px-2 py-1 mt-2" style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}>
                  {campaign.client.name}
                </span>
              )}
            </div>
            {rewardCurrency && (
              <span className="flex items-center gap-1.5 font-mono text-xs px-3 py-1" style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text)" }}>
                <Coins className="h-3 w-3" />
                {rewardCurrency}
              </span>
            )}
          </div>
          {campaign.description && (
            <p className="font-mono text-sm mt-4 leading-relaxed" style={{ color: "var(--portal-text-muted)" }}>
              {campaign.description}
            </p>
          )}
        </div>

        {/* Task types */}
        {enabledTaskSets.length > 0 && (
          <Section title="Tipos de Tarefa" icon={Layers}>
            <div className="flex flex-wrap gap-2">
              {enabledTaskSets.map(ts => (
                <span
                  key={ts.task_set_id}
                  className="font-mono text-xs px-3 py-1"
                  style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text)" }}
                >
                  {TASK_TYPE_LABELS[ts.task_type] || ts.task_type}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* Task instructions — one block per enabled task set */}
        {enabledTaskSets.map(ts => {
          const hasDo = ts.prompt_do && ts.prompt_do.length > 0;
          const hasDont = ts.prompt_dont && ts.prompt_dont.length > 0;
          const hasContent = ts.instructions_title || ts.instructions_summary || ts.prompt_topic || hasDo || hasDont;
          if (!hasContent) return null;
          return (
            <Section key={ts.task_set_id} title={TASK_TYPE_LABELS[ts.task_type] || ts.task_type} icon={BookOpen}>
              <div className="space-y-3 p-4" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-input-bg)" }}>
                {ts.instructions_title && (
                  <p className="font-mono text-sm font-bold uppercase" style={{ color: "var(--portal-text)" }}>
                    {ts.instructions_title}
                  </p>
                )}
                {ts.instructions_summary && (
                  <p className="font-mono text-xs leading-relaxed" style={{ color: "var(--portal-text-muted)" }}>
                    {ts.instructions_summary}
                  </p>
                )}
                {ts.prompt_topic && (
                  <div className="p-3 flex items-start gap-2" style={{ background: "var(--portal-bg)", border: "1px solid var(--portal-border)" }}>
                    <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: "var(--portal-text-muted)" }} />
                    <span className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
                      Tema: {ts.prompt_topic}
                    </span>
                  </div>
                )}
                {hasDo && (
                  <div className="space-y-1">
                    <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--portal-accent)" }}>O que fazer</span>
                    <ul className="space-y-1">
                      {ts.prompt_do.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 font-mono text-xs" style={{ color: "var(--portal-text)" }}>
                          <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: "var(--portal-accent)" }} />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {hasDont && (
                  <div className="space-y-1">
                    <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "hsl(0 72% 51%)" }}>O que NÃO fazer</span>
                    <ul className="space-y-1">
                      {ts.prompt_dont.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 font-mono text-xs" style={{ color: "var(--portal-text)" }}>
                          <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: "hsl(0 72% 51%)" }} />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Section>
          );
        })}

        {/* Geographic scope */}
        {geo && geo.restriction_mode && (
          <Section title="Escopo Geográfico" icon={Globe2}>
            <div className="space-y-2">
              <span className="font-mono text-[10px] uppercase tracking-widest px-2 py-0.5" style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}>
                {geo.restriction_mode === "include" ? "Apenas" : "Exceto"}
              </span>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {[...(geo.continents || []), ...(geo.countries || []), ...(geo.regions || []), ...(geo.states || []), ...(geo.cities || [])].map((place, i) => (
                  <span key={i} className="font-mono text-xs px-2 py-0.5" style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text)" }}>
                    {place}
                  </span>
                ))}
              </div>
            </div>
          </Section>
        )}

        {/* Language variants */}
        {langVariants.length > 0 && (
          <Section title="Idiomas" icon={Languages}>
            <div className="space-y-2">
              {langVariants.map(v => (
                <div
                  key={v.variant_id}
                  className="flex items-center gap-3 p-3 font-mono text-xs"
                  style={{ border: "1px solid var(--portal-border)", background: "var(--portal-input-bg)" }}
                >
                  <span style={{ color: "var(--portal-text)" }}>{v.label}</span>
                  {v.is_primary && (
                    <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5" style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}>
                      Principal
                    </span>
                  )}
                  {v.notes && (
                    <span style={{ color: "var(--portal-text-muted)" }}>— {v.notes}</span>
                  )}
                </div>
              ))}
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

        {/* Action section — depends on campaign type and timing */}
        {isBeforeStartDate ? (
          /* Campaign hasn't started — show waitlist */
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-2 p-4" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-input-bg)" }}>
              <CalendarClock className="h-4 w-4 shrink-0" style={{ color: "var(--portal-text-muted)" }} />
              <p className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
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
        ) : isAudioVideoCampaign ? (
          /* Audio/video campaign — show room creation form */
          <>
            <div className="p-6 space-y-4" style={{ borderBottom: "1px solid var(--portal-border)" }}>
              <h3 className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
                Configurar Sala
              </h3>

              {/* Topic */}
              <div className="space-y-2">
                <label className="font-mono text-xs uppercase tracking-widest flex items-center gap-2" style={{ color: "var(--portal-text-muted)" }}>
                  <MessageSquare className="h-3.5 w-3.5" /> Tema da Conversa
                </label>
                <select
                  className="portal-brutalist-input w-full"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                >
                  <option value="">Selecione um tema...</option>
                  {allTopics.map((t, i) => (
                    <option key={i} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {/* Duration */}
              <div className="space-y-2">
                <label className="font-mono text-xs uppercase tracking-widest flex items-center gap-2" style={{ color: "var(--portal-text-muted)" }}>
                  <Timer className="h-3.5 w-3.5" /> Duração da Conversa
                </label>
                <div className="flex flex-wrap gap-2">
                  {DURATION_OPTIONS.map(min => (
                    <button
                      key={min}
                      onClick={() => setDurationMinutes(min)}
                      className="font-mono text-xs px-4 py-2 transition-colors"
                      style={{
                        border: `1px solid ${durationMinutes === min ? "var(--portal-accent)" : "var(--portal-border)"}`,
                        background: durationMinutes === min ? "var(--portal-accent)" : "transparent",
                        color: durationMinutes === min ? "var(--portal-accent-text)" : "var(--portal-text-muted)",
                      }}
                    >
                      {min} min
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Room creation action */}
            <div className="p-6">
              <KGenButton
                onClick={handleCreateRoom}
                disabled={creating || !topic.trim()}
                className="w-full"
                size="default"
                scrambleText={creating ? "CRIANDO SALA..." : "CRIAR SALA DE GRAVAÇÃO"}
                icon={creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
              />
            </div>
          </>
        ) : (
          /* Other campaign types — show participate button */
          <div className="p-6">
            <KGenButton
              onClick={handleParticipate}
              disabled={creating || !user}
              className="w-full"
              size="default"
              scrambleText={creating ? "ENTRANDO..." : "PARTICIPAR"}
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
    <div className="flex items-center gap-2 p-3 font-mono text-xs" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-input-bg)" }}>
      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--portal-text-muted)" }} />
      <div className="flex flex-col">
        <span style={{ color: "var(--portal-text-muted)" }}>{label}</span>
        <span className="font-bold" style={{ color: "var(--portal-text)" }}>{value}</span>
      </div>
    </div>
  );
}
