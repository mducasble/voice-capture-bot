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

interface TranscriptionSegment {
  start: string;
  end: string;
  speaker: string;
  text: string;
}

interface JsonPreviewDialogProps {
  segments: TranscriptionSegment[];
  speakerMapping?: Record<string, string>;
  filename: string;
  children: React.ReactNode;
}

export function JsonPreviewDialog({
  segments,
  speakerMapping,
  filename,
  children,
}: JsonPreviewDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const previewSegments = useMemo(() => {
    return showAll ? segments : segments.slice(0, 5);
  }, [segments, showAll]);

  const jsonContent = useMemo(() => {
    // Force a stable key order in the exported JSON: start, end, speaker, text
    // (JS object serialization order is not reliable across runtimes)
    const ordered = segments.map((seg) => ({
      start: seg.start,
      end: seg.end,
      speaker: seg.speaker,
      text: seg.text,
    }));
    return JSON.stringify(ordered, null, 2);
  }, [segments]);

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

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5 text-accent" />
            Preview da Transcrição JSON
          </DialogTitle>
          <DialogDescription>
            {segments.length} segmentos • {speakerMapping ? Object.keys(speakerMapping).length : "?"} speakers
          </DialogDescription>
        </DialogHeader>

        {/* Speaker Mapping */}
        {speakerMapping && Object.keys(speakerMapping).length > 0 && (
          <div className="bg-muted/50 rounded-lg p-3 text-sm">
            <p className="text-xs text-muted-foreground mb-2 font-medium">Mapeamento de Speakers:</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(speakerMapping).map(([key, value]) => (
                <span
                  key={key}
                  className="px-2 py-1 bg-accent/10 text-accent rounded text-xs font-mono"
                >
                  {key} → {value}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* JSON Preview */}
        <ScrollArea className="flex-1 min-h-0 max-h-[40vh]">
          <div className="space-y-2">
            {previewSegments.map((segment, index) => (
              <div
                key={index}
                className="bg-muted/30 border border-border/50 rounded-lg p-3 text-sm font-mono"
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <span className="text-accent">{segment.speaker}</span>
                  <span>•</span>
                  <span>{segment.start} - {segment.end}</span>
                </div>
                <p className="text-foreground/90 break-words">{segment.text}</p>
              </div>
            ))}
            
            {segments.length > 5 && (
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
                    Ver todos ({segments.length - 5} restantes)
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
