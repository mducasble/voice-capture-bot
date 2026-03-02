import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Download, Copy, Check, FileJson, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { buildSpeakerTurns, type SpeakerTurnSegment } from "@/lib/speakerTurnExport";
import { Badge } from "@/components/ui/badge";

interface WordData {
  text: string;
  start: number;
  end: number;
  speaker?: string;
}

interface TranscriptJsonDialogProps {
  words: WordData[];
  language?: string;
  filename: string;
  children: React.ReactNode;
}

export function TranscriptJsonDialog({
  words,
  language = "UNK",
  filename,
  children,
}: TranscriptJsonDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const turns = useMemo(() => buildSpeakerTurns(words, language), [words, language]);

  const previewTurns = useMemo(() => {
    return showAll ? turns : turns.slice(0, 5);
  }, [turns, showAll]);

  const jsonContent = useMemo(() => {
    const wrapper = { transcriptJson: turns };
    return JSON.stringify(wrapper, null, 2);
  }, [turns]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonContent);
      setCopied(true);
      toast.success("JSON copiado para a área de transferência");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Erro ao copiar JSON");
    }
  };

  const handleDownload = () => {
    const blob = new Blob([jsonContent], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Download iniciado");
  };

  const uniqueSpeakers = useMemo(() => {
    return [...new Set(turns.map(t => t.speaker))];
  }, [turns]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5 text-accent" />
            Transcript JSON (por turno)
          </DialogTitle>
          <DialogDescription>
            {turns.length} turnos • {uniqueSpeakers.length} speakers • Idioma: {language.toUpperCase()}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 max-h-[40vh]">
          <div className="space-y-2">
            {previewTurns.map((turn, index) => (
              <div
                key={index}
                className="bg-muted/30 border border-border/50 rounded-lg p-3 text-sm font-mono"
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1 flex-wrap">
                  <span className="text-accent font-semibold">{turn.speaker}</span>
                  <span>•</span>
                  <span>{turn.start} → {turn.end}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {turn.emotion}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {turn.language}
                  </Badge>
                  {turn.end_of_speech && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-green-500/20 text-green-400">
                      end_of_speech
                    </Badge>
                  )}
                </div>
                <p className="text-foreground/90 break-words">{turn.text}</p>
              </div>
            ))}

            {turns.length > 5 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAll(!showAll)}
                className="w-full text-muted-foreground"
              >
                {showAll ? (
                  <>
                    <ChevronUp className="h-4 w-4 mr-1" />
                    Mostrar menos
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4 mr-1" />
                    Ver todos ({turns.length - 5} restantes)
                  </>
                )}
              </Button>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-row gap-2 sm:justify-between">
          <Button variant="outline" onClick={handleCopy} className="flex-1">
            {copied ? (
              <Check className="h-4 w-4 mr-2 text-green-500" />
            ) : (
              <Copy className="h-4 w-4 mr-2" />
            )}
            {copied ? "Copiado!" : "Copiar JSON"}
          </Button>
          <Button onClick={handleDownload} className="flex-1 bg-accent hover:bg-accent/90">
            <Download className="h-4 w-4 mr-2" />
            Download JSON
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
