import { Inbox } from "lucide-react";

export function EmptyState({ title = "Nenhum resultado", description = "Nenhum item encontrado para os filtros selecionados." }: { title?: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Inbox className="h-16 w-16 text-[hsl(var(--muted-foreground))]/25 mb-4" />
      <h3 className="text-[20px] font-semibold text-[hsl(var(--foreground))] mb-1">{title}</h3>
      <p className="text-[16px] text-[hsl(var(--muted-foreground))] max-w-md">{description}</p>
    </div>
  );
}
