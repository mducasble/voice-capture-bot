import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Clock, Layers, Coins, AlertTriangle } from "lucide-react";

interface TranscriptionCostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  durationSeconds: number | null;
  recordingType?: string | null;
  sessionId?: string | null;
  existingChunks?: number | null;
}

const CHUNK_DURATION_SECONDS = 30;
// ElevenLabs Scribe pricing: approximately 1000 characters ≈ 1 minute of audio
// They charge per character of output, but we estimate based on audio duration
// Average speech rate: ~150 words/min, ~750 chars/min
const ESTIMATED_CHARS_PER_MINUTE = 750;

export function TranscriptionCostDialog({
  open,
  onOpenChange,
  onConfirm,
  durationSeconds,
  recordingType,
  sessionId,
  existingChunks,
}: TranscriptionCostDialogProps) {
  const duration = durationSeconds ?? 0;
  const durationMinutes = duration / 60;
  
  // Calculate estimated chunks
  const estimatedChunks = existingChunks ?? Math.ceil(duration / CHUNK_DURATION_SECONDS);
  
  // Estimate credits (ElevenLabs charges per character, roughly 750 chars/min of audio)
  const estimatedCredits = Math.round(durationMinutes * ESTIMATED_CHARS_PER_MINUTE);
  
  // Format duration for display
  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    if (mins < 60) return `${mins}m ${secs}s`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m`;
  };

  const isMixedWithSession = recordingType === "mixed" && sessionId;
  const isLongAudio = duration > 3600; // > 1 hour

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-amber-500" />
            Estimativa de Consumo
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              <p className="text-muted-foreground">
                Confira a estimativa antes de iniciar a transcrição:
              </p>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                  <Clock className="h-4 w-4 text-blue-400" />
                  <div>
                    <p className="text-xs text-muted-foreground">Duração</p>
                    <p className="font-medium text-foreground">
                      {duration > 0 ? formatDuration(duration) : "Desconhecida"}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                  <Layers className="h-4 w-4 text-purple-400" />
                  <div>
                    <p className="text-xs text-muted-foreground">Chunks</p>
                    <p className="font-medium text-foreground">
                      {existingChunks ? `${existingChunks} prontos` : `~${estimatedChunks} estimados`}
                    </p>
                  </div>
                </div>
                
                <div className="col-span-2 flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <Coins className="h-4 w-4 text-amber-500" />
                  <div>
                    <p className="text-xs text-muted-foreground">Créditos Estimados</p>
                    <p className="font-medium text-amber-500">
                      ~{estimatedCredits.toLocaleString()} caracteres
                    </p>
                  </div>
                </div>
              </div>

              {isMixedWithSession && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
                  <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-orange-500">Track "mixed" detectado</p>
                    <p className="text-muted-foreground text-xs mt-1">
                      Esta sessão tem tracks individuais. Use "Agregar Sessão" para transcrição com nomes de speakers corretos.
                    </p>
                  </div>
                </div>
              )}

              {isLongAudio && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-red-500">Áudio longo ({formatDuration(duration)})</p>
                    <p className="text-muted-foreground text-xs mt-1">
                      Considere usar o botão de teste (4min) primeiro para validar a qualidade.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-accent hover:bg-accent/90">
            Confirmar Transcrição
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
