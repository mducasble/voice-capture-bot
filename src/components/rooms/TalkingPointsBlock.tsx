import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Sparkles, RefreshCw, Globe, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import KGenButton from "@/components/portal/KGenButton";

interface TalkingPointsBlockProps {
  topic: string | null;
}

interface TalkingPointsData {
  local_points: string[];
  global_points: string[];
}

export function TalkingPointsBlock({ topic }: TalkingPointsBlockProps) {
  const { t, i18n } = useTranslation("translation");
  const [data, setData] = useState<TalkingPointsData>({ local_points: [], global_points: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [userLocation, setUserLocation] = useState<{ country: string | null; city: string | null }>({ country: null, city: null });

  // Fetch user profile location
  useEffect(() => {
    const fetchLocation = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("country, city")
        .eq("id", user.id)
        .single();
      if (profile) {
        setUserLocation({ country: profile.country, city: profile.city });
      }
    };
    fetchLocation();
  }, []);

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
          body: JSON.stringify({
            topic,
            language: i18n.language,
            country: userLocation.country,
            city: userLocation.city,
          }),
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to generate");
      }

      const result = await res.json();
      setData({
        local_points: result.local_points || result.points || [],
        global_points: result.global_points || [],
      });
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
        className="p-5 flex-1"
        style={{ border: "1px dashed var(--portal-border)", background: "var(--portal-card-bg)", minHeight: "200px" }}
      >
        <span className="font-mono text-xs uppercase tracking-widest block mb-3" style={{ color: "var(--portal-text-muted)" }}>
          {t("room.talkingPointsTitle")}
        </span>
        <p className="font-mono text-sm leading-relaxed" style={{ color: "var(--portal-text-muted)" }}>
          {t("room.talkingPointsEmpty")}
        </p>
      </div>
    );
  }

  const locationLabel = userLocation.city && userLocation.country
    ? `${userLocation.city}, ${userLocation.country}`
    : userLocation.country || t("room.talkingPointsLocal");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-widest flex items-center gap-2" style={{ color: "var(--portal-text-muted)" }}>
          <Sparkles className="h-4 w-4" style={{ color: "var(--portal-accent)" }} />
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
        <div className="flex items-center justify-center py-12 gap-3" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
          <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--portal-accent)" }} />
          <span className="font-mono text-sm" style={{ color: "var(--portal-text-muted)" }}>
            {t("room.talkingPointsGenerating")}
          </span>
        </div>
      )}

      {error && !loading && (
        <div className="p-5 space-y-3" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
          <p className="font-mono text-sm" style={{ color: "hsl(0 84% 60%)" }}>{error}</p>
          <KGenButton variant="outline" size="sm" onClick={generate} scrambleText={t("room.talkingPointsRetry")} />
        </div>
      )}

      {!loading && !error && (data.local_points.length > 0 || data.global_points.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Local block */}
          {data.local_points.length > 0 && (
            <div className="p-5" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
              <div className="flex items-center gap-2 mb-4">
                <MapPin className="h-4 w-4" style={{ color: "var(--portal-accent)" }} />
                <span className="font-mono text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--portal-accent)" }}>
                  {locationLabel}
                </span>
              </div>
              <ul className="space-y-3">
                {data.local_points.map((point, i) => (
                  <li key={i} className="flex gap-3 items-start">
                    <span
                      className="font-mono text-[10px] font-black w-5 h-5 flex items-center justify-center shrink-0 mt-0.5"
                      style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}
                    >
                      {i + 1}
                    </span>
                    <span className="font-mono text-sm leading-relaxed" style={{ color: "var(--portal-text)" }}>
                      {point}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Global block */}
          {data.global_points.length > 0 && (
            <div className="p-5" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
              <div className="flex items-center gap-2 mb-4">
                <Globe className="h-4 w-4" style={{ color: "var(--portal-accent)" }} />
                <span className="font-mono text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--portal-accent)" }}>
                  {t("room.talkingPointsGlobal")}
                </span>
              </div>
              <ul className="space-y-3">
                {data.global_points.map((point, i) => (
                  <li key={i} className="flex gap-3 items-start">
                    <span
                      className="font-mono text-[10px] font-black w-5 h-5 flex items-center justify-center shrink-0 mt-0.5"
                      style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}
                    >
                      {i + 1}
                    </span>
                    <span className="font-mono text-sm leading-relaxed" style={{ color: "var(--portal-text)" }}>
                      {point}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
