import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Receipt, Users, Hash } from "lucide-react";

interface LedgerEntry {
  id: string;
  amount: number;
  status: string;
  entry_type: string;
  submission_type: string;
  currency: string;
  description: string | null;
  tx_hash: string | null;
  paid_at: string | null;
  credited_at: string | null;
  created_at: string;
  campaign_id: string;
  metadata: any;
}

interface CampaignName {
  id: string;
  name: string;
}

function fmt(v: number) {
  return v.toFixed(4);
}

function shortId(id: string) {
  return id.slice(0, 8);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    credited: "hsl(140 60% 50%)",
    paid: "hsl(210 80% 60%)",
    pending: "hsl(40 80% 50%)",
    cancelled: "hsl(0 60% 50%)",
  };
  return (
    <span
      className="inline-block w-2 h-2 rounded-full"
      style={{ background: colors[status] || "var(--portal-text-muted)" }}
      title={status}
    />
  );
}

export default function EarningsDetailPanel() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  const { data: entries } = useQuery({
    queryKey: ["earnings-detail", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("earnings_ledger")
        .select("id, amount, status, entry_type, submission_type, currency, description, tx_hash, paid_at, credited_at, created_at, campaign_id, metadata")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as LedgerEntry[];
    },
    enabled: !!user?.id && visible,
  });

  const { data: campaigns } = useQuery({
    queryKey: ["earnings-campaigns", user?.id],
    queryFn: async () => {
      if (!entries || entries.length === 0) return {};
      const ids = [...new Set(entries.map((e) => e.campaign_id))];
      const { data } = await supabase
        .from("campaigns")
        .select("id, name")
        .in("id", ids);
      const map: Record<string, string> = {};
      (data || []).forEach((c: CampaignName) => {
        map[c.id] = c.name;
      });
      return map;
    },
    enabled: !!entries && entries.length > 0,
  });

  // Group: direct tasks vs referral bonuses
  const directEntries = entries?.filter((e) => e.entry_type === "task_payment") || [];
  const referralEntries = entries?.filter((e) => e.entry_type === "referral_bonus") || [];

  // Group referrals by level (extracted from description "Referral L1 bonus...")
  const referralByLevel: Record<number, LedgerEntry[]> = {};
  referralEntries.forEach((e) => {
    const match = e.description?.match(/L(\d)/);
    const level = match ? parseInt(match[1]) : 0;
    if (!referralByLevel[level]) referralByLevel[level] = [];
    referralByLevel[level].push(e);
  });

  return (
    <div style={{ borderTop: "1px solid var(--portal-border)", paddingTop: "24px" }}>
      <button
        onClick={() => setVisible(!visible)}
        className="flex items-center gap-2 w-full text-left group"
      >
        {visible ? (
          <ChevronDown className="h-4 w-4" style={{ color: "var(--portal-accent)" }} />
        ) : (
          <ChevronRight className="h-4 w-4" style={{ color: "var(--portal-text-muted)" }} />
        )}
        <Receipt className="h-4 w-4" style={{ color: "var(--portal-accent)" }} />
        <h2
          className="font-mono text-xs uppercase tracking-widest font-bold"
          style={{ color: "var(--portal-text-muted)" }}
        >
          {t("earnings.detailTitle")}
        </h2>
      </button>

      {visible && (
        <div className="mt-4 space-y-6">
          {/* Direct earnings */}
          <CollapsibleSection
            title={t("earnings.detailDirect")}
            count={directEntries.length}
            total={directEntries.reduce((s, e) => s + e.amount, 0)}
          >
            <EntryTable entries={directEntries} campaigns={campaigns || {}} />
          </CollapsibleSection>

          {/* Referral by level */}
          {[1, 2, 3, 4, 5].map((lvl) => {
            const lvlEntries = referralByLevel[lvl] || [];
            if (lvlEntries.length === 0) return null;
            return (
              <CollapsibleSection
                key={lvl}
                title={`${t("earnings.detailReferral")} — ${t("earnings.level")} ${lvl}`}
                count={lvlEntries.length}
                total={lvlEntries.reduce((s, e) => s + e.amount, 0)}
                icon={<Users className="h-3.5 w-3.5" style={{ color: "var(--portal-accent)" }} />}
              >
                <EntryTable entries={lvlEntries} campaigns={campaigns || {}} />
              </CollapsibleSection>
            );
          })}

          {entries && entries.length === 0 && (
            <p
              className="font-mono text-xs text-center py-6"
              style={{ color: "var(--portal-text-muted)" }}
            >
              {t("earnings.detailEmpty")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CollapsibleSection({
  title,
  count,
  total,
  icon,
  children,
}: {
  title: string;
  count: number;
  total: number;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        border: "1px solid var(--portal-border)",
        background: "var(--portal-card-bg)",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full p-3"
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" style={{ color: "var(--portal-accent)" }} />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--portal-text-muted)" }} />
          )}
          {icon}
          <span
            className="font-mono text-xs font-bold uppercase tracking-widest"
            style={{ color: "var(--portal-text)" }}
          >
            {title}
          </span>
          <span
            className="font-mono text-[10px]"
            style={{ color: "var(--portal-text-muted)" }}
          >
            ({count})
          </span>
        </div>
        <span className="font-mono text-sm font-bold" style={{ color: "var(--portal-accent)" }}>
          US$ {fmt(total)}
        </span>
      </button>
      {open && <div className="border-t" style={{ borderColor: "var(--portal-border)" }}>{children}</div>}
    </div>
  );
}

function EntryTable({
  entries,
  campaigns,
}: {
  entries: LedgerEntry[];
  campaigns: Record<string, string>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full font-mono text-[11px]">
        <thead>
          <tr style={{ background: "hsl(0 0% 8%)" }}>
            <th className="text-left p-2 font-bold uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
              <Hash className="h-3 w-3 inline mr-1" />ID
            </th>
            <th className="text-left p-2 font-bold uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
              Data
            </th>
            <th className="text-left p-2 font-bold uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
              Campanha
            </th>
            <th className="text-left p-2 font-bold uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
              Tipo
            </th>
            <th className="text-right p-2 font-bold uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
              Valor
            </th>
            <th className="text-center p-2 font-bold uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
              Status
            </th>
            <th className="text-left p-2 font-bold uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
              TX
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr
              key={e.id}
              className="border-t"
              style={{ borderColor: "var(--portal-border)" }}
            >
              <td className="p-2" style={{ color: "var(--portal-text-muted)" }}>
                {shortId(e.id)}
              </td>
              <td className="p-2 whitespace-nowrap" style={{ color: "var(--portal-text)" }}>
                {formatDate(e.created_at)}
              </td>
              <td className="p-2 truncate max-w-[120px]" style={{ color: "var(--portal-text)" }}>
                {campaigns[e.campaign_id] || shortId(e.campaign_id)}
              </td>
              <td className="p-2 uppercase" style={{ color: "var(--portal-text-muted)" }}>
                {e.submission_type}
              </td>
              <td className="p-2 text-right font-bold" style={{ color: "var(--portal-accent)" }}>
                {fmt(e.amount)}
              </td>
              <td className="p-2 text-center">
                <StatusDot status={e.status} />
                <span className="ml-1" style={{ color: "var(--portal-text-muted)" }}>
                  {e.status}
                </span>
              </td>
              <td className="p-2" style={{ color: "var(--portal-text-muted)" }}>
                {e.tx_hash ? (
                  <a
                    href={`https://polygonscan.com/tx/${e.tx_hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                    style={{ color: "var(--portal-accent)" }}
                  >
                    {e.tx_hash.slice(0, 10)}…
                  </a>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
