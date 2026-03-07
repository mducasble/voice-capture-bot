import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

const AUTH_TIMEOUT_MS = 6000;

const withTimeout = <T,>(promise: PromiseLike<T>, timeoutMs = AUTH_TIMEOUT_MS): Promise<T> => {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error("timeout")), timeoutMs);
    }),
  ]);
};

export function useAdminAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const failSafeTimer = window.setTimeout(() => {
      if (cancelled) return;
      setIsAdmin(false);
      setLoading(false);
    }, AUTH_TIMEOUT_MS + 1000);

    const finishLoading = () => {
      window.clearTimeout(failSafeTimer);
      if (!cancelled) setLoading(false);
    };

    const checkAdmin = async (userId: string) => {
      try {
        const { data } = await withTimeout(
          supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", userId)
            .eq("role", "admin")
            .maybeSingle()
        );

        if (!cancelled) setIsAdmin(!!data);
      } catch {
        if (!cancelled) setIsAdmin(false);
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

      await checkAdmin(currentUser.id);
      finishLoading();
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session);
    });

    void (async () => {
      try {
        const {
          data: { session },
        } = await withTimeout(supabase.auth.getSession());
        await applySession(session);
      } catch {
        if (!cancelled) {
          setUser(null);
          setIsAdmin(false);
        }

        await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
        finishLoading();
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(failSafeTimer);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut({ scope: "local" });
  };

  return { user, isAdmin, loading, signOut };
}

