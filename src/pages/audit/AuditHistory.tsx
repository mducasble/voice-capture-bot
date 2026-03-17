import { PlaceholderModule } from "@/components/audit/PlaceholderModule";
import { Clock } from "lucide-react";

export default function AuditHistory() {
  return (
    <PlaceholderModule
      title="Histórico de Auditoria"
      description="Consulte todas as sessões auditadas, decisões tomadas e histórico de ações. Este módulo exibirá um log completo de todas as atividades de auditoria."
      icon={<Clock className="h-10 w-10 text-[hsl(var(--muted-foreground))]" />}
    />
  );
}
