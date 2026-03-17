export function AuditLoadingScreen({ message = "Carregando auditoria..." }: { message?: string }) {
  return (
    <div className="audit-theme min-h-screen flex items-center justify-center bg-[hsl(var(--background))]">
      <div className="flex flex-col items-center gap-4 px-6 text-center">
        <div className="h-10 w-10 rounded-full border-4 border-[hsl(var(--primary))] border-t-transparent animate-spin" />
        <p className="text-[16px] font-medium text-[hsl(var(--muted-foreground))]">{message}</p>
      </div>
    </div>
  );
}
