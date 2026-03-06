import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { processReferralOnSignup } from "@/hooks/useReferral";

/**
 * Global hook that listens for SIGNED_IN events and processes referral codes.
 * Must be mounted at the App level so it catches OAuth redirects to any route.
 */
export function useGlobalAuthReferral() {
  const processedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        // Prevent duplicate processing in the same session
        if (processedRef.current.has(session.user.id)) return;
        processedRef.current.add(session.user.id);
        await processReferralOnSignup(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, []);
}
