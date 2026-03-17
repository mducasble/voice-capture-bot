import { Construction } from "lucide-react";

interface Props {
  title: string;
  description?: string;
  icon?: React.ReactNode;
}

export function PlaceholderModule({ title, description, icon }: Props) {
  return (
    <div className="max-w-2xl mx-auto text-center py-20">
      <div className="h-20 w-20 rounded-2xl bg-[hsl(var(--muted))] flex items-center justify-center mx-auto mb-6">
        {icon || <Construction className="h-10 w-10 text-[hsl(var(--muted-foreground))]" />}
      </div>
      <h1 className="text-[28px] font-bold text-[hsl(var(--foreground))] mb-3">{title}</h1>
      <p className="text-[17px] text-[hsl(var(--muted-foreground))] leading-relaxed max-w-lg mx-auto">
        {description || "Escopo em definição. Estrutura preparada para futura implementação."}
      </p>
      <div className="mt-8 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-50 text-amber-700 text-[14px] font-medium">
        <Construction className="h-4 w-4" />
        Módulo em desenvolvimento
      </div>
    </div>
  );
}
