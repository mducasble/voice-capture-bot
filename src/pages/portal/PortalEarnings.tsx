import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Link2, Users, Copy, Check, Loader2, DollarSign, Clock, Mic, Video, Image, Tag, FileText, AlertCircle, Receipt } from "lucide-react";
import { useNavigate } from "react-router-dom";
import EarningsDetailPanel from "@/components/portal/EarningsDetailPanel";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

const ACTIVITY_KEYS = [
  { key: "audio", i18n: "earnings.activityAudio", icon: Mic },
  { key: "video", i18n: "earnings.activityVideo", icon: Video },
  { key: "image", i18n: "earnings.activityImage", icon: Image },
  { key: "annotation", i18n: "earnings.activityAnnotation", icon: Tag },
  { key: "text", i18n: "earnings.activityText", icon: FileText },
];

function fmt(v: number) {
  return v.toFixed(2);
}

function MoneyValue({ value, size = "sm", color }: { value: string; size?: "sm" | "lg"; color?: string }) {
  const textSize = size === "lg" ? "text-lg" : "text-sm";
  return (
    <span className="inline-flex flex-col items-center leading-none">
      <span className="font-mono text-[8px] uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>US$</span>
      <span className={`font-mono ${textSize} font-bold`} style={{ color: color || "var(--portal-text)" }}>{value}</span>
    </span>
  );
}

export default function PortalEarnings() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();

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

  const { data: ledgerRows } = useQuery({
    queryKey: ["earnings-ledger", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("earnings_ledger")
        .select("amount, status, entry_type, submission_type")
        .eq("user_id", user.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  const [earningsView, setEarningsView] = useState<"pending" | "all">("pending");

  const stats = useMemo(() => {
    const rows = ledgerRows || [];
    const byActivity: Record<string, { direct: number; referral: number; pending: number; tasks: number; total: number }> = {};
    ACTIVITY_KEYS.forEach(a => { byActivity[a.key] = { direct: 0, referral: 0, pending: 0, tasks: 0, total: 0 }; });

    let totalAccumulated = 0;
    let totalCredited = 0;
    let totalPaid = 0;

    for (const row of rows) {
      const type = row.submission_type || "audio";
      const bucket = byActivity[type] || byActivity["audio"];
      const amount = Number(row.amount) || 0;

      if (row.status === "cancelled") continue;

      // Global totals always count everything
      totalAccumulated += amount;
      if (row.status === "credited") totalCredited += amount;
      if (row.status === "paid") totalPaid += amount;

      // Activity breakdown respects the view filter
      if (earningsView === "pending" && row.status !== "pending") continue;

      if (row.entry_type === "referral_bonus") {
        bucket.referral += amount;
      } else {
        bucket.direct += amount;
      }
      bucket.tasks += 1;
      bucket.total += amount;

      if (row.status === "pending") {
        bucket.pending += 1;
      }
    }

    return { byActivity, totalAccumulated, availableWithdraw: totalCredited, totalPaid };
  }, [ledgerRows, earningsView]);

  const referralCode = (profile as any)?.referral_code || "";

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-center gap-3">
        <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
        <h1 className="font-mono text-xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
          {t("earnings.title")}
        </h1>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: t("earnings.totalAccumulated"), value: fmt(stats.totalAccumulated) },
          { label: t("earnings.availableWithdraw"), value: fmt(stats.availableWithdraw) },
          { label: t("earnings.totalWithdrawn"), value: fmt(stats.totalPaid) },
        ].map(item => (
          <div key={item.label} className="flex flex-col items-center justify-center p-4" style={{ border: "1px solid var(--portal-accent)", background: "hsl(0 0% 8%)" }}>
            <MoneyValue value={item.value} size="lg" color="var(--portal-accent)" />
            <span className="font-mono text-[10px] uppercase tracking-widest mt-1" style={{ color: "var(--portal-text-muted)" }}>{item.label}</span>
          </div>
        ))}
      </div>

      {/* Payment history button */}
      <button
        onClick={() => navigate("/payment-history")}
        className="w-full flex items-center justify-center gap-3 p-4 font-mono text-sm uppercase tracking-widest font-bold transition-colors"
        style={{ border: "1px solid var(--portal-accent)", background: "transparent", color: "var(--portal-accent)" }}
      >
        <Receipt className="h-4 w-4" />
        Extrato de Pagamentos
      </button>

      {/* Earnings by activity */}
      <div className="space-y-4" style={{ borderTop: "1px solid var(--portal-border)", paddingTop: "24px" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" style={{ color: "var(--portal-accent)" }} />
            <h2 className="font-mono text-xs uppercase tracking-widest font-bold" style={{ color: "var(--portal-text-muted)" }}>
              {t("earnings.earningsByActivity")}
            </h2>
          </div>
          <div className="flex font-mono text-[11px] uppercase tracking-widest font-black" style={{ border: "1px solid var(--portal-border)" }}>
            <button
              onClick={() => setEarningsView("pending")}
              className="px-3 py-1.5 transition-colors"
              style={{
                background: earningsView === "pending" ? "var(--portal-accent)" : "transparent",
                color: earningsView === "pending" ? "var(--portal-accent-text)" : "var(--portal-text)",
              }}
            >
              Pendente
            </button>
            <button
              onClick={() => setEarningsView("all")}
              className="px-3 py-1.5 transition-colors"
              style={{
                background: earningsView === "all" ? "var(--portal-accent)" : "transparent",
                color: earningsView === "all" ? "var(--portal-accent-text)" : "var(--portal-text)",
                borderLeft: "1px solid var(--portal-border)",
              }}
            >
              Geral
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ACTIVITY_KEYS.map(activity => {
            const s = stats.byActivity[activity.key];
            return (
              <div key={activity.key} className="p-4 space-y-3" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
                <div className="flex items-center gap-3">
                  <div className="p-2" style={{ background: "hsl(0 0% 15%)" }}>
                    <activity.icon className="h-4 w-4" style={{ color: "var(--portal-accent)" }} />
                  </div>
                  <p className="font-mono text-xs font-bold" style={{ color: "var(--portal-text)" }}>{t(activity.i18n)}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                <div className="p-2 text-center" style={{ background: "hsl(0 0% 10%)" }}>
                    <MoneyValue value={fmt(s.direct)} />
                    <p className="font-mono text-[9px] uppercase tracking-widest mt-1" style={{ color: "var(--portal-text-muted)" }}>{t("earnings.directEarnings")}</p>
                  </div>
                  <div className="p-2 text-center" style={{ background: "hsl(0 0% 10%)" }}>
                    <MoneyValue value={fmt(s.referral)} />
                    <p className="font-mono text-[9px] uppercase tracking-widest mt-1" style={{ color: "var(--portal-text-muted)" }}>{t("earnings.referralEarnings")}</p>
                  </div>
                </div>
                {s.pending > 0 && (
                  <div className="flex items-center gap-1.5 px-2 py-1.5" style={{ background: "hsl(40 80% 50% / 0.1)", border: "1px solid hsl(40 80% 50% / 0.2)" }}>
                    <AlertCircle className="h-3 w-3" style={{ color: "hsl(40 80% 50%)" }} />
                    <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "hsl(40 80% 50%)" }}>
                      {s.pending} {t("earnings.pendingApproval")}
                    </p>
                  </div>
                )}
                <p className="font-mono text-xs text-right" style={{ color: "var(--portal-text-muted)" }}>
                  {s.tasks} {t("earnings.tasks")} · {t("earnings.total")}: US$ {fmt(s.total)}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Referral section at the bottom */}
      <ReferralSection userId={user?.id} referralCode={referralCode} />
    </div>
  );
}

function ReferralSection({ userId, referralCode }: { userId?: string; referralCode?: string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [newCode, setNewCode] = useState(referralCode || "");
  const [copied, setCopied] = useState(false);
  const { t } = useTranslation();

  const inviteUrl = referralCode ? `${window.location.origin}/invite/${referralCode}` : "";

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
      if (!userId || !newCode.trim()) throw new Error(t("earnings.invalidCode"));
      const cleaned = newCode.trim().toLowerCase().replace(/[^a-z0-9\-_]/g, "");
      if (cleaned.length < 3) throw new Error(t("earnings.codeTooShort"));
      const { error } = await (supabase as any)
        .from("profiles")
        .update({ referral_code: cleaned })
        .eq("id", userId);
      if (error) {
        if (error.message?.includes("unique") || error.code === "23505") {
          throw new Error(t("earnings.codeInUse"));
        }
        throw error;
      }
      setNewCode(cleaned);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      setEditing(false);
      toast.success(t("earnings.codeUpdated"));
    },
    onError: (err: any) => {
      toast.error(err.message || t("common.error"));
    },
  });

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    toast.success(t("earnings.linkCopied"));
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4" style={{ borderTop: "1px solid var(--portal-border)", paddingTop: "24px" }}>
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4" style={{ color: "var(--portal-accent)" }} />
        <h2 className="font-mono text-xs uppercase tracking-widest font-bold" style={{ color: "var(--portal-text-muted)" }}>
          {t("earnings.referralLink")}
        </h2>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 px-3 py-2 font-mono text-sm truncate" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-input-bg)", color: "var(--portal-text)" }}>
          {inviteUrl || t("earnings.noCodeYet")}
        </div>
        <button onClick={handleCopy} disabled={!inviteUrl} className="p-2 transition-colors disabled:opacity-40" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-input-bg)", color: "var(--portal-text-muted)" }}>
          {copied ? <Check className="h-4 w-4" style={{ color: "var(--portal-accent)" }} /> : <Copy className="h-4 w-4" />}
        </button>
      </div>

      <div className="space-y-2">
        <label className="font-mono text-xs uppercase tracking-widest font-bold block" style={{ color: "var(--portal-text-muted)" }}>
          {t("earnings.customCode")}
        </label>
        {editing ? (
          <div className="flex items-center gap-2">
            <input type="text" value={newCode} onChange={e => setNewCode(e.target.value)} placeholder="meu-codigo" className="portal-brutalist-input flex-1" maxLength={30} />
            <button onClick={() => updateCodeMutation.mutate()} disabled={updateCodeMutation.isPending} className="px-3 py-2 font-mono text-xs uppercase tracking-widest font-bold transition-colors" style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}>
              {updateCodeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : t("earnings.save")}
            </button>
            <button onClick={() => { setEditing(false); setNewCode(referralCode || ""); }} className="px-3 py-2 font-mono text-xs" style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}>
              {t("earnings.cancel")}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm" style={{ color: "var(--portal-text)" }}>{referralCode || "—"}</span>
            <button onClick={() => { setNewCode(referralCode || ""); setEditing(true); }} className="font-mono text-xs underline" style={{ color: "var(--portal-accent)" }}>
              {t("earnings.change")}
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2">
        {[1, 2, 3, 4, 5].map(lvl => (
          <div key={lvl} className="text-center p-3" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
            <p className="font-mono text-lg font-black" style={{ color: "var(--portal-text)" }}>{referralStats?.levels?.[lvl - 1] ?? 0}</p>
            <p className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>{t("earnings.level")} {lvl}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-6 pt-1">
        <div className="flex items-center gap-2">
          <Users className="h-3.5 w-3.5" style={{ color: "var(--portal-text-muted)" }} />
          <span className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
            {t("earnings.direct")}: <span style={{ color: "var(--portal-text)", fontWeight: 700 }}>{referralStats?.direct ?? 0}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Users className="h-3.5 w-3.5" style={{ color: "var(--portal-text-muted)" }} />
          <span className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
            {t("earnings.totalNetwork")}: <span style={{ color: "var(--portal-text)", fontWeight: 700 }}>{referralStats?.total ?? 0}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
