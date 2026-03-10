import { useState, useCallback, useRef } from "react";
import {
  type CarouselSlide,
  type CarouselElement,
  type CarouselFormat,
  type BackgroundPattern,
  CAROUSEL_FORMATS,
  CAROUSEL_TEMPLATES,
  GRID_SIZE,
  ACCENT_COLOR,
  getPatternColors,
  createSlide,
  createId,
} from "./types";
import { DraggableElement } from "./DraggableElement";
import { ElementPropertiesPanel } from "./ElementPropertiesPanel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Type,
  ImageIcon,
  Download,
  Copy,
  Layers,
} from "lucide-react";
import { toast } from "sonner";

export default function CarouselEditor() {
  const [format, setFormat] = useState<CarouselFormat>(CAROUSEL_FORMATS[0]);
  const [slides, setSlides] = useState<CarouselSlide[]>([createSlide(CAROUSEL_TEMPLATES[1].slides[0])]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedElId, setSelectedElId] = useState<string | null>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);

  const currentSlide = slides[currentIdx];
  const selectedElement = currentSlide?.elements.find((e) => e.id === selectedElId) ?? null;

  // Scale for preview
  const previewMaxW = 520;
  const scale = Math.min(previewMaxW / format.width, 650 / format.height);

  // -- Slide management --
  const addSlide = () => {
    const s = createSlide({ elements: [], backgroundColor: currentSlide?.backgroundColor || "#111111" });
    setSlides((prev) => [...prev, s]);
    setCurrentIdx(slides.length);
    setSelectedElId(null);
  };

  const duplicateSlide = () => {
    if (!currentSlide) return;
    const dup = createSlide({
      elements: currentSlide.elements.map((el) => ({ ...el })),
      backgroundColor: currentSlide.backgroundColor,
      backgroundGradient: currentSlide.backgroundGradient,
    });
    const newSlides = [...slides];
    newSlides.splice(currentIdx + 1, 0, dup);
    setSlides(newSlides);
    setCurrentIdx(currentIdx + 1);
    setSelectedElId(null);
  };

  const deleteSlide = () => {
    if (slides.length <= 1) return;
    setSlides((prev) => prev.filter((_, i) => i !== currentIdx));
    setCurrentIdx((prev) => Math.min(prev, slides.length - 2));
    setSelectedElId(null);
  };

  // -- Element management --
  const addElement = (type: "text" | "image") => {
    const el: CarouselElement = {
      id: createId(),
      type,
      x: 80,
      y: 200,
      width: type === "text" ? 600 : 400,
      height: type === "text" ? 100 : 300,
      rotation: 0,
      ...(type === "text"
        ? { content: "Novo texto", fontSize: 40, fontWeight: 700, color: "#ffffff", textAlign: "left" as const, fontFamily: "monospace" }
        : {}),
    };
    updateSlide({ elements: [...currentSlide.elements, el] });
    setSelectedElId(el.id);
  };

  const updateSlide = (updates: Partial<CarouselSlide>) => {
    setSlides((prev) => prev.map((s, i) => (i === currentIdx ? { ...s, ...updates } : s)));
  };

  const updateElement = (elId: string, updates: Partial<CarouselElement>) => {
    updateSlide({
      elements: currentSlide.elements.map((el) => (el.id === elId ? { ...el, ...updates } : el)),
    });
  };

  const deleteElement = (elId: string) => {
    updateSlide({ elements: currentSlide.elements.filter((el) => el.id !== elId) });
    setSelectedElId(null);
  };

  // -- Template --
  const applyTemplate = (templateId: string) => {
    const tpl = CAROUSEL_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    setSlides(tpl.slides.map((s) => createSlide(s)));
    setCurrentIdx(0);
    setSelectedElId(null);
  };

  // -- Export --
  const exportSlide = useCallback(
    async (slideIndex: number) => {
      const slide = slides[slideIndex];
      if (!slide) return null;

      const canvas = document.createElement("canvas");
      canvas.width = format.width;
      canvas.height = format.height;
      const ctx = canvas.getContext("2d")!;

      // Background
      ctx.fillStyle = slide.backgroundColor;
      ctx.fillRect(0, 0, format.width, format.height);

      // Render elements in order
      for (const el of slide.elements) {
        if (el.type === "text") {
          ctx.save();
          ctx.font = `${el.fontWeight || 400} ${el.fontSize || 32}px ${el.fontFamily || "monospace"}`;
          ctx.fillStyle = el.color || "#ffffff";
          ctx.textAlign = el.textAlign || "left";
          ctx.textBaseline = "top";

          const lines = wrapText(ctx, el.content || "", el.width);
          const lineHeight = (el.fontSize || 32) * 1.3;
          const textX = el.textAlign === "center" ? el.x + el.width / 2 : el.textAlign === "right" ? el.x + el.width : el.x;
          lines.forEach((line, li) => {
            ctx.fillText(line, textX, el.y + li * lineHeight);
          });
          ctx.restore();
        }

        if (el.type === "image" && el.imageUrl) {
          try {
            const img = await loadImage(el.imageUrl);
            ctx.drawImage(img, el.x, el.y, el.width, el.height);
          } catch {
            // skip broken images
          }
        }
      }

      return canvas;
    },
    [slides, format]
  );

  const handleExportAll = useCallback(async () => {
    toast.info("Exportando slides...");
    for (let i = 0; i < slides.length; i++) {
      const canvas = await exportSlide(i);
      if (!canvas) continue;
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      if (!blob) continue;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `carousel-slide-${i + 1}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
    toast.success(`${slides.length} slides exportados!`);
  }, [slides, exportSlide]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_260px] gap-6">
      {/* Left panel: slides & controls */}
      <div className="space-y-4">
        {/* Format */}
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Formato</Label>
          <Select
            value={format.id}
            onValueChange={(v) => {
              setFormat(CAROUSEL_FORMATS.find((f) => f.id === v)!);
            }}
          >
            <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CAROUSEL_FORMATS.map((f) => (
                <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Template */}
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Template</Label>
          <Select onValueChange={applyTemplate}>
            <SelectTrigger className="text-xs"><SelectValue placeholder="Escolher template" /></SelectTrigger>
            <SelectContent>
              {CAROUSEL_TEMPLATES.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Slide thumbnails */}
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-widest text-muted-foreground font-mono">
            Slides ({slides.length})
          </Label>
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
            {slides.map((slide, idx) => {
              const thumbScale = 200 / format.width;
              return (
                <button
                  key={slide.id}
                  onClick={() => { setCurrentIdx(idx); setSelectedElId(null); }}
                  className="relative w-full rounded border-2 overflow-hidden transition-colors"
                  style={{
                    borderColor: idx === currentIdx ? "#8cff05" : "transparent",
                    aspectRatio: `${format.width} / ${format.height}`,
                    background: slide.backgroundGradient || slide.backgroundColor,
                  }}
                >
                  <div
                    className="absolute inset-0 origin-top-left pointer-events-none"
                    style={{ transform: `scale(${thumbScale})`, width: format.width, height: format.height }}
                  >
                    {slide.elements.map((el) => (
                      <div
                        key={el.id}
                        style={{
                          position: "absolute",
                          left: el.x,
                          top: el.y,
                          width: el.width,
                          height: el.height,
                          fontSize: el.type === "text" ? el.fontSize : undefined,
                          fontWeight: el.type === "text" ? el.fontWeight : undefined,
                          color: el.type === "text" ? el.color : undefined,
                          textAlign: el.type === "text" ? el.textAlign : undefined,
                          fontFamily: el.type === "text" ? (el.fontFamily || "monospace") : undefined,
                          lineHeight: 1.3,
                          overflow: "hidden",
                        }}
                      >
                        {el.type === "text" ? el.content : null}
                        {el.type === "image" && el.imageUrl ? (
                          <img src={el.imageUrl} alt="" className="w-full h-full object-cover" />
                        ) : el.type === "image" ? (
                          <div className="w-full h-full bg-white/10" />
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <span className="absolute bottom-1 right-2 text-[10px] font-mono text-white/50">{idx + 1}</span>
                </button>
              );
            })}
          </div>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={addSlide}>
              <Plus className="h-3 w-3 mr-1" /> Novo
            </Button>
            <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={duplicateSlide}>
              <Copy className="h-3 w-3 mr-1" /> Duplicar
            </Button>
            <Button variant="outline" size="sm" className="text-xs text-destructive" onClick={deleteSlide} disabled={slides.length <= 1}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* Center: Canvas */}
      <div className="space-y-3">
        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => addElement("text")}>
            <Type className="h-3.5 w-3.5 mr-1.5" /> Texto
          </Button>
          <Button variant="outline" size="sm" onClick={() => addElement("image")}>
            <ImageIcon className="h-3.5 w-3.5 mr-1.5" /> Imagem
          </Button>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={currentIdx === 0} onClick={() => { setCurrentIdx(currentIdx - 1); setSelectedElId(null); }}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span>{currentIdx + 1} / {slides.length}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={currentIdx >= slides.length - 1} onClick={() => { setCurrentIdx(currentIdx + 1); setSelectedElId(null); }}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Button size="sm" onClick={handleExportAll}>
            <Download className="h-3.5 w-3.5 mr-1.5" /> Exportar Todos
          </Button>
        </div>

        {/* Canvas */}
        <div
          ref={canvasAreaRef}
          className="border border-border rounded-lg overflow-hidden inline-block"
          style={{ width: format.width * scale, height: format.height * scale }}
        >
          <div
            onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedElId(null); }}
            style={{
              width: format.width,
              height: format.height,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              position: "relative",
              background: currentSlide?.backgroundGradient || currentSlide?.backgroundColor || "#111",
            }}
          >
            {currentSlide?.elements.map((el) => (
              <DraggableElement
                key={el.id}
                element={el}
                isSelected={selectedElId === el.id}
                onSelect={() => setSelectedElId(el.id)}
                onUpdate={(updates) => updateElement(el.id, updates)}
                scale={scale}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Right panel: properties */}
      <div className="space-y-4">
        {/* Slide background */}
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Fundo do Slide</Label>
          <div className="flex gap-2">
            <input
              type="color"
              value={currentSlide?.backgroundColor || "#111111"}
              onChange={(e) => updateSlide({ backgroundColor: e.target.value })}
              className="w-9 h-9 rounded cursor-pointer border-0 p-0"
            />
            <Input
              value={currentSlide?.backgroundColor || "#111111"}
              onChange={(e) => updateSlide({ backgroundColor: e.target.value })}
              className="text-xs flex-1"
            />
          </div>
        </div>

        {/* Selected element */}
        {selectedElement ? (
          <ElementPropertiesPanel
            element={selectedElement}
            onUpdate={(updates) => updateElement(selectedElement.id, updates)}
            onDelete={() => deleteElement(selectedElement.id)}
          />
        ) : (
          <div className="p-4 text-center text-xs text-muted-foreground border border-dashed border-border rounded">
            <Layers className="h-8 w-8 mx-auto mb-2 opacity-30" />
            Selecione um elemento para editar suas propriedades
          </div>
        )}
      </div>
    </div>
  );
}

// -- Helpers --

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(" ");
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [""];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
