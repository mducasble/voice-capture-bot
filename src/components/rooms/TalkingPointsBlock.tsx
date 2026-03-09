import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Sparkles, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import KGenButton from "@/components/portal/KGenButton";

interface TalkingPointsBlockProps {
  topic: string | null;
}

export function TalkingPointsBlock({ topic }: TalkingPointsBlockProps) {
  const { t, i18n } = useTranslation("translation");
  const [points, setPoints] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);

  const generate = async () => {
    if (!topic) return;
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-talking-points`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ topic, language: i18n.language }),
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to generate");
      }

      const data = await res.json();
      setPoints(data.points || []);
      setHasGenerated(true);
    } catch (e: any) {
      console.error("Talking points error:", e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Auto-generate on mount if topic exists
  useEffect(() => {
    if (topic && !hasGenerated && !loading) {
      generate();
    }
  }, [topic]);

  if (!topic) {
    return (
      <div
        className="p-4 flex-1"
        style={{ border: "1px dashed var(--portal-border)", background: "var(--portal-card-bg)", minHeight: "200px" }}
      >
        <span className="font-mono text-[10px] uppercase tracking-widest block mb-3" style={{ color: "var(--portal-text-muted)" }}>
          {t("room.talkingPointsTitle")}
        </span>
        <p className="font-mono text-xs leading-relaxed" style={{ color: "var(--portal-text-muted)" }}>
          {t("room.talkingPointsEmpty")}
        </p>
      </div>
    );
  }

  return (
    <div
      className="p-4 flex-1"
      style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)", minHeight: "200px" }}
    >
      <div className="flex items-center justify-between mb-4">
        <span className="font-mono text-[10px] uppercase tracking-widest flex items-center gap-2" style={{ color: "var(--portal-text-muted)" }}>
          <Sparkles className="h-3.5 w-3.5" style={{ color: "var(--portal-accent)" }} />
          {t("room.talkingPointsTitle")}
        </span>
        {hasGenerated && !loading && (
          <button
            onClick={generate}
            className="p-1.5 transition-colors"
            style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}
            title={t("room.talkingPointsRegenerate")}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8 gap-3">
          <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--portal-accent)" }} />
          <span className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
            {t("room.talkingPointsGenerating")}
          </span>
        </div>
      )}

      {error && !loading && (
        <div className="space-y-3">
          <p className="font-mono text-xs" style={{ color: "hsl(0 84% 60%)" }}>{error}</p>
          <KGenButton variant="outline" size="sm" onClick={generate} scrambleText={t("room.talkingPointsRetry")} />
        </div>
      )}

      {!loading && !error && points.length > 0 && (
        <ul className="space-y-2.5">
          {points.map((point, i) => (
            <li key={i} className="flex gap-3 items-start">
              <span
                className="font-mono text-[10px] font-black w-5 h-5 flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}
              >
                {i + 1}
              </span>
              <span className="font-mono text-xs leading-relaxed" style={{ color: "var(--portal-text)" }}>
                {point}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
