import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link2, Users, Copy, Check, Loader2, DollarSign, Clock, Mic, Video, Image, Tag, FileText, AlertCircle } from "lucide-react";
import { toast } from "sonner";

const ACTIVITY_TYPES = [
  { key: "audio_capture_solo", label: "Áudio Solo", icon: Mic },
  { key: "audio_capture_group", label: "Áudio Grupo", icon: Mic },
  { key: "video_submission", label: "Vídeo", icon: Video },
  { key: "image_submission", label: "Imagem", icon: Image },
  { key: "data_labeling", label: "Data Labelling", icon: Tag },
  { key: "transcription", label: "Transcrição", icon: FileText },
];

export default function PortalEarnings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("referral_code")
        .eq("id", user.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  const referralCode = (profile as any)?.referral_code || "";

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
        <h1 className="font-mono text-xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
          Meus Ganhos
        </h1>
      </div>

      {/* Referral Section */}
      <ReferralSection userId={user?.id} referralCode={referralCode} />

      {/* Activity Earnings */}
      <div className="space-y-4" style={{ borderTop: "1px solid var(--portal-border)", paddingTop: "24px" }}>
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4" style={{ color: "var(--portal-accent)" }} />
          <h2 className="font-mono text-xs uppercase tracking-widest font-bold" style={{ color: "var(--portal-text-muted)" }}>
            Ganhos por Atividade
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ACTIVITY_TYPES.map(activity => (
            <div
              key={activity.key}
              className="p-4 space-y-3"
              style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}
            >
              <div className="flex items-center gap-3">
                <div className="p-2" style={{ background: "hsl(0 0% 15%)" }}>
                  <activity.icon className="h-4 w-4" style={{ color: "var(--portal-accent)" }} />
                </div>
                <p className="font-mono text-xs font-bold" style={{ color: "var(--portal-text)" }}>
                  {activity.label}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 text-center" style={{ background: "hsl(0 0% 10%)" }}>
                  <p className="font-mono text-sm font-bold" style={{ color: "var(--portal-text)" }}>$0.00</p>
                  <p className="font-mono text-[9px] uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>Direto</p>
                </div>
                <div className="p-2 text-center" style={{ background: "hsl(0 0% 10%)" }}>
                  <p className="font-mono text-sm font-bold" style={{ color: "var(--portal-text)" }}>$0.00</p>
                  <p className="font-mono text-[9px] uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>Referral</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1.5" style={{ background: "hsl(40 80% 50% / 0.1)", border: "1px solid hsl(40 80% 50% / 0.2)" }}>
                <AlertCircle className="h-3 w-3" style={{ color: "hsl(40 80% 50%)" }} />
                <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "hsl(40 80% 50%)" }}>
                  0 pendentes de aprovação
                </p>
              </div>
              <p className="font-mono text-xs text-right" style={{ color: "var(--portal-text-muted)" }}>
                0 tarefas · Total: $0.00
              </p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: "Total Acumulado", value: "$0.00" },
            { label: "Disponível p/ Saque", value: "$0.00" },
            { label: "Total Sacado", value: "$0.00" },
          ].map(item => (
            <div
              key={item.label}
              className="flex flex-col items-center justify-center p-4"
              style={{ border: "1px solid var(--portal-accent)", background: "hsl(0 0% 8%)" }}
            >
              <span className="font-mono text-lg font-black" style={{ color: "var(--portal-accent)" }}>
                {item.value}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-widest mt-1" style={{ color: "var(--portal-text-muted)" }}>
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReferralSection({ userId, referralCode }: { userId?: string; referralCode?: string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [newCode, setNewCode] = useState(referralCode || "");
  const [copied, setCopied] = useState(false);

  const inviteUrl = `${window.location.origin}/invite/${referralCode || ""}`;

  const { data: referralStats } = useQuery({
    queryKey: ["referral-stats", userId],
    queryFn: async () => {
      if (!userId) return { direct: 0, total: 0, levels: [0, 0, 0, 0, 0] };
      const { data, error } = await (supabase as any)
        .from("referrals")
        .select("id, level_1, level_2, level_3, level_4, level_5")
        .or(`level_1.eq.${userId},level_2.eq.${userId},level_3.eq.${userId},level_4.eq.${userId},level_5.eq.${userId}`);
      if (error) return { direct: 0, total: 0, levels: [0, 0, 0, 0, 0] };
      const rows = data || [];
      const levels = [1, 2, 3, 4, 5].map(
        lvl => rows.filter((r: any) => r[`level_${lvl}`] === userId).length
      );
      return { direct: levels[0], total: rows.length, levels };
    },
    enabled: !!userId,
  });

  const updateCodeMutation = useMutation({
    mutationFn: async () => {
      if (!userId || !newCode.trim()) throw new Error("Código inválido");
      const cleaned = newCode.trim().toLowerCase().replace(/[^a-z0-9\-_]/g, "");
      if (cleaned.length < 3) throw new Error("Código deve ter pelo menos 3 caracteres");
      const { error } = await (supabase as any)
        .from("profiles")
        .update({ referral_code: cleaned })
        .eq("id", userId);
      if (error) {
        if (error.message?.includes("unique") || error.code === "23505") {
          throw new Error("Este código já está em uso");
        }
        throw error;
      }
      setNewCode(cleaned);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      setEditing(false);
      toast.success("Código de referral atualizado!");
    },
    onError: (err: any) => {
      toast.error(err.message || "Erro ao atualizar código");
    },
  });

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    toast.success("Link copiado!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4" style={{ borderTop: "1px solid var(--portal-border)", paddingTop: "24px" }}>
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4" style={{ color: "var(--portal-accent)" }} />
        <h2 className="font-mono text-xs uppercase tracking-widest font-bold" style={{ color: "var(--portal-text-muted)" }}>
          Link de Referral
        </h2>
      </div>

      {/* Invite link */}
      <div className="flex items-center gap-2">
        <div
          className="flex-1 px-3 py-2 font-mono text-sm truncate"
          style={{ border: "1px solid var(--portal-border)", background: "var(--portal-input-bg)", color: "var(--portal-text)" }}
        >
          {inviteUrl}
        </div>
        <button
          onClick={handleCopy}
          className="p-2 transition-colors"
          style={{ border: "1px solid var(--portal-border)", background: "var(--portal-input-bg)", color: "var(--portal-text-muted)" }}
        >
          {copied ? <Check className="h-4 w-4" style={{ color: "var(--portal-accent)" }} /> : <Copy className="h-4 w-4" />}
        </button>
      </div>

      {/* Edit code */}
      <div className="space-y-2">
        <label className="font-mono text-xs uppercase tracking-widest font-bold block" style={{ color: "var(--portal-text-muted)" }}>
          Código Personalizado
        </label>
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newCode}
              onChange={e => setNewCode(e.target.value)}
              placeholder="meu-codigo"
              className="portal-brutalist-input flex-1"
              maxLength={30}
            />
            <button
              onClick={() => updateCodeMutation.mutate()}
              disabled={updateCodeMutation.isPending}
              className="px-3 py-2 font-mono text-xs uppercase tracking-widest font-bold transition-colors"
              style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}
            >
              {updateCodeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Salvar"}
            </button>
            <button
              onClick={() => { setEditing(false); setNewCode(referralCode || ""); }}
              className="px-3 py-2 font-mono text-xs"
              style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}
            >
              Cancelar
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm" style={{ color: "var(--portal-text)" }}>
              {referralCode || "—"}
            </span>
            <button
              onClick={() => { setNewCode(referralCode || ""); setEditing(true); }}
              className="font-mono text-xs underline"
              style={{ color: "var(--portal-accent)" }}
            >
              Alterar
            </button>
          </div>
        )}
      </div>

      {/* Stats by level */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2">
        {[1, 2, 3, 4, 5].map(lvl => (
          <div
            key={lvl}
            className="text-center p-3"
            style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}
          >
            <p className="font-mono text-lg font-black" style={{ color: "var(--portal-text)" }}>
              {referralStats?.levels?.[lvl - 1] ?? 0}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
              Nível {lvl}
            </p>
          </div>
        ))}
      </div>

      <div className="flex gap-6 pt-1">
        <div className="flex items-center gap-2">
          <Users className="h-3.5 w-3.5" style={{ color: "var(--portal-text-muted)" }} />
          <span className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
            Diretos: <span style={{ color: "var(--portal-text)", fontWeight: 700 }}>{referralStats?.direct ?? 0}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Users className="h-3.5 w-3.5" style={{ color: "var(--portal-text-muted)" }} />
          <span className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
            Rede total: <span style={{ color: "var(--portal-text)", fontWeight: 700 }}>{referralStats?.total ?? 0}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
