import { useNavigate } from "react-router-dom";
import { Headphones, Video, Image, CheckSquare, FileText } from "lucide-react";
import { useState } from "react";

type MediaType = "audio" | "video" | "photo";
type ProcessType = "validation" | "transcription";

const mediaOptions = [
  { id: "audio" as MediaType, label: "Áudio", description: "Gravações de voz e conversas", icon: Headphones, ready: true },
  { id: "video" as MediaType, label: "Vídeo", description: "Arquivos de vídeo gravados", icon: Video, ready: false },
  { id: "photo" as MediaType, label: "Foto", description: "Imagens e capturas", icon: Image, ready: false },
];

const processOptions = [
  { id: "validation" as ProcessType, label: "Validação", description: "Aprovar ou reprovar itens com base em métricas de qualidade", icon: CheckSquare },
  { id: "transcription" as ProcessType, label: "Transcrição", description: "Revisar e corrigir textos transcritos", icon: FileText },
];

export default function AuditHome() {
  const navigate = useNavigate();
  const [selectedMedia, setSelectedMedia] = useState<MediaType | null>(null);

  const handleProcessSelect = (process: ProcessType) => {
    if (!selectedMedia) return;
    if (selectedMedia === "audio") {
      navigate(`/audit/audio/${process}`);
    } else {
      navigate(`/audit/${selectedMedia}`);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Step 1: Media */}
      <div className="mb-10">
        <h1 className="text-[28px] font-bold text-[hsl(var(--foreground))] mb-2">
          Escolha o que deseja auditar
        </h1>
        <p className="text-[17px] text-[hsl(var(--muted-foreground))] mb-8">
          Selecione o tipo de mídia para iniciar o processo de auditoria
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {mediaOptions.map((opt) => (
            <button
              key={opt.id}
              onClick={() => opt.ready ? setSelectedMedia(opt.id) : undefined}
              disabled={!opt.ready}
              className={`
                relative text-left p-7 rounded-2xl border-2 transition-all
                ${selectedMedia === opt.id
                  ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 shadow-md"
                  : opt.ready
                    ? "border-[hsl(var(--border))] bg-white hover:border-[hsl(var(--primary))]/40 hover:shadow-sm cursor-pointer"
                    : "border-[hsl(var(--border))] bg-[hsl(var(--muted))] opacity-60 cursor-not-allowed"
                }
              `}
            >
              {!opt.ready && (
                <span className="absolute top-4 right-4 text-[12px] font-medium text-[hsl(var(--muted-foreground))] bg-[hsl(var(--border))] px-2 py-0.5 rounded-md">
                  Em breve
                </span>
              )}
              <div className={`h-14 w-14 rounded-xl flex items-center justify-center mb-5 ${
                selectedMedia === opt.id ? "bg-[hsl(var(--primary))] text-white" : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
              }`}>
                <opt.icon className="h-7 w-7" />
              </div>
              <h3 className="text-[20px] font-bold text-[hsl(var(--foreground))] mb-1">{opt.label}</h3>
              <p className="text-[15px] text-[hsl(var(--muted-foreground))]">{opt.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Step 2: Process */}
      {selectedMedia && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
          <h2 className="text-[24px] font-bold text-[hsl(var(--foreground))] mb-2">
            Escolha o processo
          </h2>
          <p className="text-[17px] text-[hsl(var(--muted-foreground))] mb-6">
            O que você deseja fazer com os itens de {mediaOptions.find(m => m.id === selectedMedia)?.label.toLowerCase()}?
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {processOptions.map((opt) => (
              <button
                key={opt.id}
                onClick={() => handleProcessSelect(opt.id)}
                className="text-left p-7 rounded-2xl border-2 border-[hsl(var(--border))] bg-white hover:border-[hsl(var(--primary))]/40 hover:shadow-sm transition-all cursor-pointer"
              >
                <div className="h-14 w-14 rounded-xl bg-[hsl(var(--muted))] flex items-center justify-center mb-5 text-[hsl(var(--muted-foreground))]">
                  <opt.icon className="h-7 w-7" />
                </div>
                <h3 className="text-[20px] font-bold text-[hsl(var(--foreground))] mb-1">{opt.label}</h3>
                <p className="text-[15px] text-[hsl(var(--muted-foreground))]">{opt.description}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
