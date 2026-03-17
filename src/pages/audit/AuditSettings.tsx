import { Settings, User, Globe } from "lucide-react";

export default function AuditSettings() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-[28px] font-bold text-[hsl(var(--foreground))] mb-2">Configurações</h1>
      <p className="text-[17px] text-[hsl(var(--muted-foreground))] mb-8">Ajustes do painel de auditoria</p>

      <div className="space-y-4">
        {[
          { icon: User, label: "Perfil", desc: "Dados pessoais e preferências" },
          { icon: Globe, label: "Idioma", desc: "Idioma da interface" },
          { icon: Settings, label: "Preferências", desc: "Configurações de notificação e exibição" },
        ].map((item) => (
          <div key={item.label} className="p-6 rounded-2xl border border-[hsl(var(--border))] bg-white flex items-center gap-5">
            <div className="h-12 w-12 rounded-xl bg-[hsl(var(--muted))] flex items-center justify-center">
              <item.icon className="h-6 w-6 text-[hsl(var(--muted-foreground))]" />
            </div>
            <div>
              <h3 className="text-[18px] font-semibold text-[hsl(var(--foreground))]">{item.label}</h3>
              <p className="text-[15px] text-[hsl(var(--muted-foreground))]">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
