import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { detectBrowserCountry } from "@/hooks/useUserCountry";

/**
 * On mount, if the authenticated user has no country in their profile,
 * silently auto-fill it from the browser timezone.
 */
export function useAutoFillCountry() {
  const { user } = useAuth();
  const attempted = useRef(false);

  useEffect(() => {
    if (!user?.id || attempted.current) return;
    attempted.current = true;

    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("country")
        .eq("id", user.id)
        .single();

      if (data?.country && (data.country as string).trim()) return;

      const detected = detectBrowserCountry();
      if (!detected) return;

      await supabase
        .from("profiles")
        .update({ country: detected } as any)
        .eq("id", user.id);
    })();
  }, [user?.id]);
}
