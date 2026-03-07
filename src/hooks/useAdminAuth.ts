import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

const AUTH_FALLBACK_MS = 8000;

export function useAdminAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const finishLoading = () => {
      if (!cancelled) setLoading(false);
    };

    const fallbackTimer = window.setTimeout(() => {
      if (cancelled) return;
      setLoading(false);
    }, AUTH_FALLBACK_MS);

    const checkAdmin = async (userId: string): Promise<boolean> => {
      try {
        const { data, error } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .eq("role", "admin")
          .maybeSingle();

        if (error) return false;
        return !!data;
      } catch {
        return false;
      }
    };

    const applySession = async (session: Session | null) => {
      const currentUser = session?.user ?? null;
      if (!cancelled) setUser(currentUser);

      if (!currentUser) {
        if (!cancelled) setIsAdmin(false);
        finishLoading();
        return;
      }

      const admin = await checkAdmin(currentUser.id);
      if (!cancelled) setIsAdmin(admin);
      finishLoading();
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session);
    });

    void supabase.auth
      .getSession()
      .then(({ data: { session } }) => applySession(session))
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setIsAdmin(false);
        }
        finishLoading();
      });

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return { user, isAdmin, loading, signOut };
}


