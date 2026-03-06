import { useParams, useNavigate } from "react-router-dom";
import { useCampaign } from "@/hooks/useCampaigns";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  ArrowLeft, Radio, Loader2, MessageSquare, Timer, Upload, Users,
} from "lucide-react";
import { useState, useMemo } from "react";
import KGenButton from "@/components/portal/KGenButton";
import { TASK_TYPE_LABELS, TASK_TYPE_CATEGORIES } from "@/lib/campaignTypes";
import { PortalMultiSpeakerUpload } from "@/components/portal/PortalMultiSpeakerUpload";

const DURATION_OPTIONS = [10, 15, 20, 25, 30];

export default function PortalCampaignTask() {
  const { id } = useParams<{ id: string }>();
  const { data: campaign, isLoading } = useCampaign(id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [topic, setTopic] = useState("");
  const [durationMinutes, setDurationMinutes] = useState<number>(10);
  const [mode, setMode] = useState<"choose" | "room" | "upload">("choose");

  const enabledTaskSets = campaign?.task_sets?.filter(ts => ts.enabled) || [];
  const activeSections = campaign?.sections?.filter(s => s.is_active) || [];
  // Use sections if available, fallback to prompt_topic from task sets
  const allTopics = activeSections.length > 0
    ? activeSections.map(s => s.name)
    : enabledTaskSets.filter(ts => ts.prompt_topic).map(ts => ts.prompt_topic!);

  // Determine primary task category
  const primaryCategory = useMemo(() => {
    if (!enabledTaskSets.length) return null;
    const first = enabledTaskSets[0];
    return TASK_TYPE_CATEGORIES[first.task_type] || null;
  }, [enabledTaskSets]);

  const handleCreateRoom = async () => {
    if (!user || !campaign) return;
    if (!topic.trim()) {
      toast.error("Selecione o tema da conversa");
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

      // Insert creator as participant
      const { data: participant, error: partError } = await supabase
        .from("room_participants")
        .insert({
          room_id: room.id,
          name: userName,
          is_creator: true,
          user_id: user?.id || null,
        })
        .select()
        .single();

      if (partError) throw partError;

      // Store participant ID for Room.tsx auto-connect
      sessionStorage.setItem(`room_${room.id}_participant`, participant.id);
      navigate(`/room/${room.id}?campaign=${campaign.id}`);
    } catch (err: any) {
      toast.error("Erro ao criar sala: " + err.message);
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
      </div>
    );
  }

  // Audio/video group — show choice or specific mode
  if (primaryCategory === "audio" || primaryCategory === "video") {
    // Choose mode
    if (mode === "choose") {
      return (
        <div className="space-y-6 max-w-3xl mx-auto">
          <button
            onClick={() => navigate(`/campaign/${id}`)}
            className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest transition-colors"
            style={{ color: "var(--portal-text-muted)" }}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar à Campanha
          </button>

          <div style={{ border: "1px solid var(--portal-border)" }}>
            <div className="p-6" style={{ borderBottom: "1px solid var(--portal-border)" }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
                <span className="font-mono text-xs tracking-[0.3em] uppercase" style={{ color: "var(--portal-accent)" }}>
                  Executar Tarefa
                </span>
              </div>
              <h1 className="font-mono text-xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
                {campaign.name}
              </h1>
              <p className="font-mono text-xs mt-2" style={{ color: "var(--portal-text-muted)" }}>
                Escolha como deseja enviar os áudios da campanha.
              </p>
            </div>

            <div className="p-6 grid gap-4 sm:grid-cols-2">
              {/* Option 1: Create Room */}
              <button
                onClick={() => setMode("room")}
                className="p-6 text-left transition-colors group"
                style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2" style={{ background: "var(--portal-accent)" }}>
                    <Radio className="h-5 w-5" style={{ color: "var(--portal-accent-text)" }} />
                  </div>
                  <span className="font-mono text-sm font-bold uppercase" style={{ color: "var(--portal-text)" }}>
                    Criar Sala
                  </span>
                </div>
                <p className="font-mono text-xs leading-relaxed" style={{ color: "var(--portal-text-muted)" }}>
                  Grave ao vivo com outro participante. Crie uma sala, compartilhe o link e conversem em tempo real.
                </p>
              </button>

              {/* Option 2: Manual Upload */}
              <button
                onClick={() => setMode("upload")}
                className="p-6 text-left transition-colors group"
                style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2" style={{ background: "var(--portal-accent)" }}>
                    <Upload className="h-5 w-5" style={{ color: "var(--portal-accent-text)" }} />
                  </div>
                  <span className="font-mono text-sm font-bold uppercase" style={{ color: "var(--portal-text)" }}>
                    Enviar Áudios
                  </span>
                </div>
                <p className="font-mono text-xs leading-relaxed" style={{ color: "var(--portal-text-muted)" }}>
                  Envie arquivos de áudio separados por participante. Ideal para gravações já realizadas.
                </p>
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Room creation mode
    if (mode === "room") {
      return (
        <div className="space-y-6 max-w-3xl mx-auto">
          <button
            onClick={() => setMode("choose")}
            className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest transition-colors"
            style={{ color: "var(--portal-text-muted)" }}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar
          </button>

          <div style={{ border: "1px solid var(--portal-border)" }}>
            <div className="p-6" style={{ borderBottom: "1px solid var(--portal-border)" }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
                <span className="font-mono text-xs tracking-[0.3em] uppercase" style={{ color: "var(--portal-accent)" }}>
                  Configurar Gravação
                </span>
              </div>
              <h1 className="font-mono text-xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
                {campaign.name}
              </h1>
            </div>

            {/* Topic */}
            <div className="p-6 space-y-4" style={{ borderBottom: "1px solid var(--portal-border)" }}>
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

            {/* Action */}
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

    // Manual upload mode
    if (mode === "upload") {
      return (
        <div className="space-y-6 max-w-3xl mx-auto">
          <button
            onClick={() => setMode("choose")}
            className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest transition-colors"
            style={{ color: "var(--portal-text-muted)" }}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar
          </button>

          <div style={{ border: "1px solid var(--portal-border)" }}>
            <div className="p-6" style={{ borderBottom: "1px solid var(--portal-border)" }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
                <span className="font-mono text-xs tracking-[0.3em] uppercase" style={{ color: "var(--portal-accent)" }}>
                  Enviar Áudios
                </span>
              </div>
              <h1 className="font-mono text-xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
                {campaign.name}
              </h1>
            </div>

            <div className="p-6">
              <PortalMultiSpeakerUpload campaignId={campaign.id} />
            </div>
          </div>
        </div>
      );
    }
  }

  // Default — placeholder for other task types
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <button
        onClick={() => navigate(`/campaign/${id}`)}
        className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest transition-colors"
        style={{ color: "var(--portal-text-muted)" }}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar à Campanha
      </button>

      <div className="p-8 text-center" style={{ border: "1px solid var(--portal-border)" }}>
        <p className="font-mono text-sm" style={{ color: "var(--portal-text-muted)" }}>
          Área de tarefas em breve.
        </p>
      </div>
    </div>
  );
}
