import { useParams, useNavigate } from "react-router-dom";
import { useCampaign } from "@/hooks/useCampaigns";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ArrowLeft, Radio, Clock, FileText, Loader2, MessageSquare, Timer } from "lucide-react";
import { useState } from "react";
import KGenButton from "@/components/portal/KGenButton";

const DURATION_OPTIONS = [10, 15, 20, 25, 30];

export default function PortalCampaign() {
  const { id } = useParams<{ id: string }>();
  const { data: campaign, isLoading } = useCampaign(id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [topic, setTopic] = useState("");
  const [durationMinutes, setDurationMinutes] = useState<number>(10);

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
      navigate(`/portal/room/${room.id}?campaign=${campaign.id}`);
    } catch (err: any) {
      toast.error("Erro ao criar sala: " + err.message);
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
          onClick={() => navigate("/portal")}
          className="font-mono text-xs uppercase tracking-widest mt-4 px-4 py-2 transition-colors"
          style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}
        >
          Voltar
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Back button */}
      <button
        onClick={() => navigate("/portal")}
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
          </div>
          {campaign.description && (
            <p className="font-mono text-sm mt-4 leading-relaxed" style={{ color: "var(--portal-text-muted)" }}>
              {campaign.description}
            </p>
          )}
        </div>

        {/* Audio requirements */}
        <div className="p-6" style={{ borderBottom: "1px solid var(--portal-border)" }}>
          <h3 className="font-mono text-xs uppercase tracking-widest mb-3" style={{ color: "var(--portal-text-muted)" }}>
            Requisitos de Áudio
          </h3>
          <div className="flex flex-wrap gap-2">
            {[
              `${campaign.audio_sample_rate || 48000}Hz`,
              `${campaign.audio_bit_depth || 16}bit`,
              `${campaign.audio_channels || 1}ch`,
              (campaign.audio_format || "WAV").toUpperCase(),
              ...(campaign.audio_min_snr_db ? [`SNR ≥ ${campaign.audio_min_snr_db}dB`] : []),
            ].map(spec => (
              <span
                key={spec}
                className="font-mono text-xs px-3 py-1"
                style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text)" }}
              >
                {spec}
              </span>
            ))}
          </div>
        </div>

        {/* Duration limits */}
        {(campaign.audio_min_duration_seconds || campaign.audio_max_duration_seconds) && (
          <div className="p-6 flex gap-6" style={{ borderBottom: "1px solid var(--portal-border)" }}>
            {campaign.audio_min_duration_seconds && (
              <span className="flex items-center gap-2 font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
                <Clock className="h-3.5 w-3.5" />
                Mín: {campaign.audio_min_duration_seconds}s
              </span>
            )}
            {campaign.audio_max_duration_seconds && (
              <span className="flex items-center gap-2 font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
                <Clock className="h-3.5 w-3.5" />
                Máx: {campaign.audio_max_duration_seconds}s
              </span>
            )}
          </div>
        )}

        {/* Task Config */}
        {campaign.task_config && (
          <div className="p-6" style={{ borderBottom: "1px solid var(--portal-border)" }}>
            <h3 className="font-mono text-xs uppercase tracking-widest mb-4" style={{ color: "var(--portal-text-muted)" }}>
              Instruções da Tarefa
            </h3>
            <div className="p-4 space-y-2" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-input-bg)" }}>
              {campaign.task_config.instructions_title && (
                <p className="font-mono text-sm font-bold uppercase" style={{ color: "var(--portal-text)" }}>
                  {campaign.task_config.instructions_title}
                </p>
              )}
              {campaign.task_config.instructions_summary && (
                <p className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
                  {campaign.task_config.instructions_summary}
                </p>
              )}
              {campaign.task_config.prompt_topic && (
                <div className="mt-2 p-3 flex items-start gap-2" style={{ background: "var(--portal-bg)", border: "1px solid var(--portal-border)" }}>
                  <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: "var(--portal-text-muted)" }} />
                  <span className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
                    Tema: {campaign.task_config.prompt_topic}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Room creation form */}
        <div className="p-6 space-y-4" style={{ borderBottom: "1px solid var(--portal-border)" }}>
          <h3 className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
            Configurar Sala
          </h3>

          {/* Topic - select from campaign sections */}
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
              {campaign.task_config?.prompt_topic && (
                <option value={campaign.task_config.prompt_topic}>
                  {campaign.task_config.prompt_topic}
                </option>
              )}
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

        {/* Actions */}
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
      </div>
    </div>
  );
}
