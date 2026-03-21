import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DataAudioPlayer } from "@/components/data/DataAudioPlayer";
import { Check, Headphones, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SpeakerPreview {
  speaker: string;
  url: string;
}

interface SpeakerSelectDialogProps {
  open: boolean;
  speakers: SpeakerPreview[];
  targetTrackName: string;
  onSelect: (speaker: SpeakerPreview) => void;
  onCancel: () => void;
  applying: boolean;
}

export function SpeakerSelectDialog({
  open, speakers, targetTrackName, onSelect, onCancel, applying,
}: SpeakerSelectDialogProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const handleConfirm = () => {
    const sp = speakers.find(s => s.speaker === selected);
    if (sp) onSelect(sp);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !applying) onCancel(); }}>
      <DialogContent className="max-w-lg bg-[#1a1a2e] border-white/10 text-white">
        <DialogHeader>
          <DialogTitle className="text-white">Selecionar Speaker</DialogTitle>
          <DialogDescription className="text-white/50">
            Ouça os speakers reconstruídos e escolha qual corresponde à trilha <strong className="text-white/80">{targetTrackName}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {speakers.map((sp) => (
            <div
              key={sp.speaker}
              onClick={() => !applying && setSelected(sp.speaker)}
              className={cn(
                "rounded-xl p-4 border cursor-pointer transition-all",
                selected === sp.speaker
                  ? "border-violet-500/60 bg-violet-500/10"
                  : "border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06]"
              )}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="h-8 w-8 rounded-lg bg-white/[0.06] flex items-center justify-center">
                  <Headphones className="h-4 w-4 text-white/40" />
                </div>
                <span className="text-sm font-semibold text-white/80">
                  {sp.speaker.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                </span>
                {selected === sp.speaker && (
                  <Check className="h-4 w-4 text-violet-400 ml-auto" />
                )}
              </div>
              <DataAudioPlayer src={sp.url} />
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={onCancel} disabled={applying} className="text-white/50">
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selected || applying}
            className="bg-violet-600 hover:bg-violet-700 text-white"
          >
            {applying ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Aplicando...</>
            ) : (
              "Confirmar & Substituir"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
