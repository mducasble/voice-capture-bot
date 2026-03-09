import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

/**
 * Returns whether the user's profile is "complete" — i.e. has all required fields filled.
 * Required: full_name, country, city, spoken_languages (non-empty), desired_opportunities (non-empty).
 */
export function useProfileCompletion() {
  const { user } = useAuth();

  const { data: isComplete, isLoading } = useQuery({
    queryKey: ["profile-completion", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name, country, city, spoken_languages, desired_opportunities")
        .eq("id", user!.id)
        .single();
      if (!data) return false;
      const p = data as any;
      return !!(
        p.full_name?.trim() &&
        p.country?.trim() &&
        p.city?.trim() &&
        Array.isArray(p.spoken_languages) && p.spoken_languages.length > 0 &&
        Array.isArray(p.desired_opportunities) && p.desired_opportunities.length > 0
      );
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  return { isComplete: isComplete ?? true, isLoading };
}
