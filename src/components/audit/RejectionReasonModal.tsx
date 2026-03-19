import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { XCircle, CheckSquare } from "lucide-react";
import { cn } from "@/lib/utils";

const ADMIN_REJECTION_REASONS = [
  "Número insuficiente de participantes",
  "Áudio abaixo do padrão mínimo de qualidade",
  "Desvio do tema superior a 20%",
  "Participante infringiu as regras de produção ou envio de material",
  "Duração menor que o tempo previsto",
  "Material inconsistente (Upload de arquivos de duração diferentes)",
  "Um dos participantes já ultrapassou a cota máxima dessa campanha",
  "Participantes não enviaram áudio isolado",
];

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (reasons: string[], note: string) => void;
  campaignId: string;
  type?: "quality" | "validation";
  useAdminReasons?: boolean;
}

export function RejectionReasonModal({ open, onClose, onConfirm, campaignId, type = "quality", useAdminReasons = false }: Props) {
  const [reasons, setReasons] = useState<string[]>([]);
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    if (useAdminReasons) {
      setReasons(ADMIN_REJECTION_REASONS);
      return;
    }
    if (!campaignId) return;
    supabase
      .from("campaign_quality_flow")
      .select("rejection_reasons")
      .eq("campaign_id", campaignId)
      .maybeSingle()
      .then(({ data }) => {
        setReasons(data?.rejection_reasons || ADMIN_REJECTION_REASONS);
      });
  }, [open, campaignId, useAdminReasons]);

  const toggle = (r: string) => {
    setSelectedReasons((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]
    );
  };

  const handleConfirm = () => {
    onConfirm(selectedReasons, note);
    setSelectedReasons([]);
    setNote("");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg bg-zinc-900 border-zinc-700 text-white">
        <DialogHeader>
          <DialogTitle className="text-[22px] font-bold text-white flex items-center gap-2">
            <XCircle className="h-6 w-6 text-red-500" />
            Motivos da Reprovação
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-[16px] text-zinc-300">
            Selecione um ou mais motivos para reprovação:
          </p>
          <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
            {reasons.map((r) => (
              <button
                key={r}
                onClick={() => toggle(r)}
                className={cn(
                  "w-full text-left px-4 py-3.5 rounded-xl border-2 text-[15px] font-medium transition-all flex items-center gap-3",
                  selectedReasons.includes(r)
                    ? "border-red-400 bg-red-500/20 text-red-300"
                    : "border-zinc-600 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                )}
              >
                <CheckSquare className={cn("h-5 w-5 shrink-0", selectedReasons.includes(r) ? "text-red-400" : "text-zinc-500")} />
                {r}
              </button>
            ))}
          </div>
          <div>
            <p className="text-[15px] font-medium text-zinc-200 mb-2">
              Justificativa adicional (opcional):
            </p>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Adicione observações adicionais, se necessário..."
              className="min-h-[100px] text-[15px] rounded-xl resize-none bg-zinc-800 border-zinc-600 text-white placeholder:text-zinc-500"
            />
          </div>
        </div>

        <DialogFooter className="gap-3">
          <Button variant="outline" onClick={onClose} className="h-12 px-6 text-[15px] rounded-xl border-zinc-600 text-zinc-200 hover:bg-zinc-800">
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={selectedReasons.length === 0 && !note.trim()}
            className="h-12 px-6 text-[15px] rounded-xl bg-red-600 hover:bg-red-700 text-white"
          >
            Confirmar Reprovação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
