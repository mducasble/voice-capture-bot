import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";

const FLAG_REASONS = [
  "Áudio Pode Melhorar (Enhance)",
  "Chance de ser Duplicado",
  "Mais de 2 participantes",
  "Som estourado",
  "Uma ou mais trilhas ruins",
];

interface FlagReasonModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

export function FlagReasonModal({ open, onClose, onConfirm }: FlagReasonModalProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const handleConfirm = () => {
    if (!selected) return;
    onConfirm(selected);
    setSelected(null);
  };

  const handleClose = () => {
    setSelected(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="bg-[hsl(240_6%_10%)] border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-400">
            <Flag className="h-5 w-5" /> Motivo do Flag
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2 py-2">
          {FLAG_REASONS.map((reason) => (
            <button
              key={reason}
              onClick={() => setSelected(reason)}
              className={cn(
                "text-left px-4 py-3 rounded-xl border text-[14px] font-medium transition-all",
                selected === reason
                  ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                  : "bg-white/[0.04] border-white/[0.08] text-white/70 hover:bg-white/[0.08] hover:text-white/90"
              )}
            >
              {reason}
            </button>
          ))}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={handleClose} className="text-white/50 hover:text-white/80">
            Cancelar
          </Button>
          <Button
            disabled={!selected}
            onClick={handleConfirm}
            className="bg-amber-500 hover:bg-amber-400 text-white font-semibold"
          >
            Confirmar Flag
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
