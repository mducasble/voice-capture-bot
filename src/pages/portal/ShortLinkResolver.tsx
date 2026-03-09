import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export default function ShortLinkResolver() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!slug) return;

    (async () => {
      const { data } = await supabase
        .from("short_links")
        .select("target_path")
        .eq("slug", slug)
        .single();

      if (data?.target_path) {
        // Extract ref param to save referral and process immediately
        try {
          const url = new URL(data.target_path, window.location.origin);
          const ref = url.searchParams.get("ref");
          if (ref) {
            localStorage.setItem("referral_code", ref);
            // Process referral immediately if already authenticated
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
              const { processReferralOnSignup } = await import("@/hooks/useReferral");
              await processReferralOnSignup(user.id);
            }
          }
        } catch {}
        navigate(data.target_path, { replace: true });
      } else {
        setError(true);
      }
    })();
  }, [slug, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--portal-bg)", color: "var(--portal-text-muted)" }}>
        <p className="font-mono text-sm">Link não encontrado</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--portal-bg)" }}>
      <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--portal-accent)" }} />
    </div>
  );
}
