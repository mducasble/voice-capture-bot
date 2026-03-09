import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CampaignSelectorProps {
  value: string;
  onChange: (id: string) => void;
  className?: string;
}

export function CampaignSelector({ value, onChange, className }: CampaignSelectorProps) {
  const { data: campaigns, isLoading } = useQuery({
    queryKey: ["campaigns-selector"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("id, name, is_active, campaign_status")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const activeCampaigns = campaigns?.filter(c => c.is_active) ?? [];
  const inactiveCampaigns = campaigns?.filter(c => !c.is_active) ?? [];

  return (
    <Select value={value} onValueChange={onChange} disabled={isLoading}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={isLoading ? "Carregando..." : "Selecionar campanha"} />
      </SelectTrigger>
      <SelectContent>
        {activeCampaigns.map(c => (
          <SelectItem key={c.id} value={c.id}>
            🟢 {c.name}
          </SelectItem>
        ))}
        {inactiveCampaigns.length > 0 && activeCampaigns.length > 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">Inativas</div>
        )}
        {inactiveCampaigns.map(c => (
          <SelectItem key={c.id} value={c.id}>
            ⚪ {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
