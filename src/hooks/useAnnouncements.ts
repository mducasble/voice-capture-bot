import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface Announcement {
  id: string;
  title: string;
  message: string | null;
  link_url: string | null;
  link_label: string | null;
  announcement_type: string;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
}

export function useAnnouncements() {
  const { user } = useAuth();

  const { data: announcements = [] } = useQuery({
    queryKey: ["announcements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("announcements")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const now = new Date().toISOString();
      return (data as unknown as Announcement[]).filter(
        (a) => !a.expires_at || a.expires_at > now
      );
    },
    refetchInterval: false,
    retry: false,
  });

  const { data: dismissedIds = [] } = useQuery({
    queryKey: ["announcement-dismissals", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("announcement_dismissals")
        .select("announcement_id")
        .eq("user_id", user.id);
      if (error) throw error;
      return (data as any[]).map((d) => d.announcement_id as string);
    },
    enabled: !!user,
  });

  const queryClient = useQueryClient();

  const dismiss = useMutation({
    mutationFn: async (announcementId: string) => {
      if (!user) return;
      const { error } = await supabase
        .from("announcement_dismissals")
        .insert({ announcement_id: announcementId, user_id: user.id } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["announcement-dismissals"] });
    },
  });

  const visible = announcements.filter((a) => !dismissedIds.includes(a.id));

  return { announcements: visible, dismiss: dismiss.mutate };
}
