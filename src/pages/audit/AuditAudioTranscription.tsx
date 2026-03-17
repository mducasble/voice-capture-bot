import { PlaceholderModule } from "@/components/audit/PlaceholderModule";
import { FileText } from "lucide-react";

export default function AuditAudioTranscription() {
  return (
    <PlaceholderModule
      title="Transcrição de Áudio"
      description="Módulo de revisão e correção de textos transcritos a partir de gravações de áudio. Estrutura preparada para futura implementação com player integrado, texto editável e controle de qualidade."
      icon={<FileText className="h-10 w-10 text-[hsl(var(--muted-foreground))]" />}
    />
  );
}
