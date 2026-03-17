import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Headphones, Video, Image } from "lucide-react";

type MediaType = "audio" | "video" | "photo";

const mediaOptions: { id: MediaType; label: string; description: string; icon: typeof Headphones; ready: boolean }[] = [
  { id: "audio", label: "Áudio", description: "Valide gravações de voz e conversas", icon: Headphones, ready: true },
  { id: "video", label: "Vídeo", description: "Valide arquivos de vídeo gravados", icon: Video, ready: false },
  { id: "photo", label: "Foto", description: "Valide imagens e capturas", icon: Image, ready: false },
];

export default function DataHome() {
  const navigate = useNavigate();

  const handleSelect = (type: MediaType) => {
    navigate(`/data/${type}/campaigns`);
  };

  return (
    <div className="max-w-3xl mx-auto flex flex-col items-center pt-8 md:pt-16">
      <h1 className="text-[32px] md:text-[40px] font-bold text-white tracking-tight text-center mb-3">
        O que você quer validar?
      </h1>
      <p className="text-[16px] md:text-[18px] text-white/40 text-center mb-12 max-w-md">
        Escolha o tipo de conteúdo para começar a contribuir
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 w-full">
        {mediaOptions.map((opt) => (
          <button
            key={opt.id}
            onClick={() => opt.ready ? handleSelect(opt.id) : undefined}
            disabled={!opt.ready}
            className={`
              group relative flex flex-col items-center text-center p-8 md:p-10 rounded-3xl transition-all duration-300
              ${opt.ready
                ? "data-glass-card hover:bg-white/[0.08] hover:border-[hsl(var(--primary))]/40 hover:shadow-lg hover:shadow-[hsl(var(--primary))]/10 hover:scale-[1.02] cursor-pointer"
                : "data-glass-card opacity-40 cursor-not-allowed"
              }
            `}
          >
            {!opt.ready && (
              <span className="absolute top-4 right-4 text-[11px] font-semibold text-white/30 bg-white/[0.06] px-2.5 py-1 rounded-full">
                Em breve
              </span>
            )}

            <div className={`
              h-20 w-20 rounded-2xl flex items-center justify-center mb-6 transition-all duration-300
              ${opt.ready
                ? "bg-white/[0.06] text-white/70 border border-white/[0.08] group-hover:bg-white/[0.12] group-hover:text-white group-hover:shadow-lg group-hover:shadow-white/[0.04]"
                : "bg-white/[0.03] text-white/15"
              }
            `}>
              <opt.icon className="h-10 w-10" strokeWidth={1.5} />
            </div>

            <h3 className="text-[22px] font-bold text-white mb-2">{opt.label}</h3>
            <p className="text-[14px] text-white/40 leading-relaxed">{opt.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
