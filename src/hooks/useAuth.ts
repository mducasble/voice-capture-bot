import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

const AUTH_FALLBACK_MS = 8000;

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const finishLoading = () => {
      if (!cancelled) setLoading(false);
    };

    const fallbackTimer = window.setTimeout(() => {
      if (cancelled) return;
      setUser(null);
      setSession(null);
      setLoading(false);
    }, AUTH_FALLBACK_MS);

    const applySession = (nextSession: Session | null) => {
      if (cancelled) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      finishLoading();
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      applySession(nextSession);
    });

    void supabase.auth
      .getSession()
      .then(({ data: { session: nextSession } }) => {
        applySession(nextSession);
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        setSession(null);
        finishLoading();
      });

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    sessionStorage.setItem("is_logging_out", "true");
    setUser(null);
    setSession(null);
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // ignore
    }
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore - server session may already be gone
    }
    window.location.href = '/auth';
  }, []);

  return { user, session, loading, signOut };
}
