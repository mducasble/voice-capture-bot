import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MaintenanceConfig {
  id: string;
  is_active: boolean;
  scheduled_at: string | null;
  message: string | null;
  estimated_duration_minutes: number | null;
}

const CONFIG_ID = "00000000-0000-0000-0000-000000000001";

export function useMaintenance() {
  return useQuery({
    queryKey: ["maintenance-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_config")
        .select("*")
        .eq("id", CONFIG_ID)
        .single();
      if (error) throw error;
      return data as unknown as MaintenanceConfig;
    },
    refetchInterval: false,
    retry: false,
  });
}

export { CONFIG_ID };
