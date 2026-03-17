import { PlaceholderModule } from "@/components/audit/PlaceholderModule";
import { Video } from "lucide-react";

export default function AuditVideoModule() {
  return (
    <PlaceholderModule
      title="Módulo de Vídeo"
      description="Validação e transcrição de conteúdos em vídeo. Este módulo está em fase de definição de escopo e será implementado com a mesma qualidade e clareza do módulo de áudio."
      icon={<Video className="h-10 w-10 text-[hsl(var(--muted-foreground))]" />}
    />
  );
}
