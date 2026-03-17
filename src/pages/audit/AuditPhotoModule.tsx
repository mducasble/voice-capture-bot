import { PlaceholderModule } from "@/components/audit/PlaceholderModule";
import { Image } from "lucide-react";

export default function AuditPhotoModule() {
  return (
    <PlaceholderModule
      title="Módulo de Foto"
      description="Validação e classificação de imagens capturadas. Estrutura preparada para suportar visualização, anotação e controle de qualidade de fotografias."
      icon={<Image className="h-10 w-10 text-[hsl(var(--muted-foreground))]" />}
    />
  );
}
