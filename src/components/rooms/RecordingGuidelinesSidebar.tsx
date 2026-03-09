import { useState, useEffect } from "react";
import { BookOpen, X, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

const GUIDELINES = [
  {
    number: 1,
    title: "Ambiente de Gravação",
    text: "Grave em local silencioso com mínimo de ruído de fundo. Evite sons de ventiladores, TV, música, trânsito ou outras pessoas falando. Um cômodo fechado é recomendado.",
  },
  {
    number: 2,
    title: "Qualidade do Áudio",
    text: "Use um microfone ou headset de boa qualidade. Ambos devem ser claramente audíveis. Mantenha distância consistente do microfone e evite tocar ou mover o dispositivo.",
  },
  {
    number: 3,
    title: "Dois Participantes",
    text: "A conversa deve incluir dois falantes diferentes. Cada pessoa deve falar naturalmente e se revezar. Evite interromper ou falar ao mesmo tempo.",
  },
  {
    number: 4,
    title: "Conversa Natural",
    text: "Fale de forma natural e clara, como em uma conversa normal. Evite soar robótico ou excessivamente roteirizado. O diálogo deve parecer realista.",
  },
  {
    number: 5,
    title: "Siga o Tema",
    text: "Se um tópico ou prompt for fornecido, mantenha a conversa relevante. Ambos devem participar ativamente.",
  },
  {
    number: 6,
    title: "Ritmo da Fala",
    text: "Fale em ritmo moderado e claro. Não fale rápido nem devagar demais e pronuncie as palavras com clareza.",
  },
  {
    number: 7,
    title: "Sem Dados Pessoais",
    text: "Não mencione nomes completos reais, endereços, números de telefone, documentos ou qualquer informação pessoal sensível.",
  },
  {
    number: 8,
    title: "Gravação Contínua",
    text: "A conversa deve ser gravada continuamente sem cortes ou edições, salvo instruções específicas.",
  },
  {
    number: 9,
    title: "Duração da Gravação",
    text: "O tempo pode variar: 10, 15, 20, 25 ou 30 minutos, dependendo das instruções da tarefa.",
  },
  {
    number: 10,
    title: "Consistência",
    text: "Mantenha o mesmo ambiente, distância do microfone e clareza de voz durante toda a conversa.",
  },
];

export function RecordingGuidelinesSidebar() {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    // Fechar automaticamente após 5 segundos
    const timer = setTimeout(() => {
      setOpen(false);
    }, 5000);
    
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      {/* Toggle button - always visible */}
      <button
        onClick={() => setOpen(true)}
        className={`fixed right-0 top-1/2 -translate-y-1/2 z-40 flex items-center gap-2 py-6 px-3 font-mono text-[18px] font-black uppercase tracking-widest transition-all ${
          !open ? "animate-pulse" : ""
        }`}
        style={{
          background: "var(--portal-accent)",
          color: "var(--portal-accent-text)",
          writingMode: "vertical-rl",
          textOrientation: "mixed",
          borderRadius: "8px 0 0 8px",
          display: open ? "none" : "flex",
          boxShadow: !open ? "0 0 20px var(--portal-accent)" : "none",
        }}
      >
        <BookOpen className="h-6 w-6 rotate-90" />
        Instruções
      </button>

      {/* Overlay backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar panel */}
      <div
        className="fixed top-0 right-0 h-full z-50 transition-transform duration-300 ease-in-out"
        style={{
          width: "380px",
          maxWidth: "90vw",
          transform: open ? "translateX(0)" : "translateX(100%)",
          background: "var(--portal-bg, #0a0a0a)",
          borderLeft: "1px solid var(--portal-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between p-4"
          style={{ borderBottom: "1px solid var(--portal-border)" }}
        >
          <div className="flex items-center gap-3">
            <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
            <span
              className="font-mono text-xs font-bold uppercase tracking-[0.2em]"
              style={{ color: "var(--portal-text)" }}
            >
              Instruções de Gravação
            </span>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 transition-colors"
            style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <ScrollArea className="h-[calc(100%-60px)]">
          <div className="p-4 space-y-3">
            {GUIDELINES.map((g) => (
              <div
                key={g.number}
                className="p-3 space-y-1.5"
                style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="font-mono text-[10px] font-black w-5 h-5 flex items-center justify-center shrink-0"
                    style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}
                  >
                    {g.number}
                  </span>
                  <span
                    className="font-mono text-xs font-bold uppercase tracking-wide"
                    style={{ color: "var(--portal-text)" }}
                  >
                    {g.title}
                  </span>
                </div>
                <p
                  className="font-mono text-[11px] leading-relaxed pl-7"
                  style={{ color: "var(--portal-text-muted)" }}
                >
                  {g.text}
                </p>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    </>
  );
}
