import { useState, useCallback, useRef, useEffect } from "react";
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
  Highlighter,
  Smile,
  Heart,
  Save,
  FolderOpen,
  FilePlus,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface SavedProject {
  id: string;
  name: string;
  format_id: string;
  slides: CarouselSlide[];
  created_at: string;
  updated_at: string;
}

export default function CarouselEditor() {
  const [format, setFormat] = useState<CarouselFormat>(CAROUSEL_FORMATS[0]);
  const [slides, setSlides] = useState<CarouselSlide[]>([createSlide(CAROUSEL_TEMPLATES[1].slides[0])]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedElId, setSelectedElId] = useState<string | null>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);

  // Save/load state
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("Sem título");
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [showProjectList, setShowProjectList] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load saved projects list
  const loadProjects = useCallback(async () => {
    const { data } = await supabase
      .from("carousel_projects")
      .select("id, name, format_id, slides, created_at, updated_at")
      .order("updated_at", { ascending: false });
    if (data) setSavedProjects(data as unknown as SavedProject[]);
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Faça login primeiro"); return; }

      const payload = {
        name: projectName,
        format_id: format.id,
        slides: JSON.parse(JSON.stringify(slides)),
        created_by: user.id,
        updated_at: new Date().toISOString(),
      };

      if (projectId) {
        const { error } = await supabase
          .from("carousel_projects")
          .update(payload)
          .eq("id", projectId);
        if (error) throw error;
        toast.success("Projeto salvo!");
      } else {
        const { data, error } = await supabase
          .from("carousel_projects")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        setProjectId(data.id);
        toast.success("Projeto criado!");
      }
      loadProjects();
    } catch (e: any) {
      toast.error("Erro ao salvar: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLoad = (project: SavedProject) => {
    setProjectId(project.id);
    setProjectName(project.name);
    setFormat(CAROUSEL_FORMATS.find(f => f.id === project.format_id) || CAROUSEL_FORMATS[0]);
    setSlides(project.slides);
    setCurrentIdx(0);
    setSelectedElId(null);
    setShowProjectList(false);
    toast.success(`"${project.name}" carregado`);
  };

  const handleDuplicate = async (project: SavedProject) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from("carousel_projects")
      .insert({
        name: project.name + " (cópia)",
        format_id: project.format_id,
        slides: JSON.parse(JSON.stringify(project.slides)),
        created_by: user.id,
      })
      .select("id")
      .single();
    if (error) { toast.error("Erro ao duplicar"); return; }
    toast.success("Projeto duplicado!");
    loadProjects();
    // Load the duplicate
    handleLoad({ ...project, id: data.id, name: project.name + " (cópia)" });
  };

  const handleDeleteProject = async (id: string) => {
    const { error } = await supabase.from("carousel_projects").delete().eq("id", id);
    if (error) { toast.error("Erro ao deletar"); return; }
    if (projectId === id) { setProjectId(null); setProjectName("Sem título"); }
    toast.success("Projeto deletado");
    loadProjects();
  };

  const handleNewProject = () => {
    setProjectId(null);
    setProjectName("Sem título");
    setSlides([createSlide(CAROUSEL_TEMPLATES[1].slides[0])]);
    setCurrentIdx(0);
    setSelectedElId(null);
    setShowProjectList(false);
  };

  const currentSlide = slides[currentIdx];
  const selectedElement = currentSlide?.elements.find((e) => e.id === selectedElId) ?? null;

  // Scale for preview
  const previewMaxW = 520;
  const scale = Math.min(previewMaxW / format.width, 650 / format.height);

  // -- Slide management --
  const addSlide = () => {
    const s = createSlide({ elements: [], backgroundColor: currentSlide?.backgroundColor || "#111111", backgroundPattern: currentSlide?.backgroundPattern || "dark-grid" });
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
      backgroundPattern: currentSlide.backgroundPattern,
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
  const addElement = (type: "text" | "image" | "highlight" | "icon") => {
    const el: CarouselElement = {
      id: createId(),
      type,
      x: 80,
      y: 200,
      width: type === "image" ? 400 : type === "highlight" ? 400 : type === "icon" ? 120 : 600,
      height: type === "image" ? 300 : type === "highlight" ? 80 : type === "icon" ? 120 : 100,
      rotation: 0,
      ...(type === "text"
        ? { content: "Novo texto", fontSize: 40, fontWeight: 700, color: "#ffffff", textAlign: "left" as const, fontFamily: "monospace" }
        : {}),
      ...(type === "highlight"
        ? { content: "HIGHLIGHT", fontSize: 48, fontWeight: 900, color: "#111111", textAlign: "center" as const, fontFamily: "monospace", highlightBg: "#8cff05", highlightPaddingX: 24, highlightPaddingY: 12 }
        : {}),
      ...(type === "icon"
        ? { iconName: "star", color: "#ffffff" }
        : {}),
    };
    updateSlide({ elements: [...currentSlide.elements, el] });
    setSelectedElId(el.id);
  };

  const addSocialBlock = () => {
    const gap = 24;
    const iconSize = 64;
    const barWidth = iconSize * 3 + gap * 4;
    const barHeight = iconSize + gap * 2;
    const startX = Math.round((format.width - barWidth) / 2);
    const startY = format.height - 200;

    const bgEl: CarouselElement = {
      id: createId(),
      type: "highlight",
      x: startX,
      y: startY,
      width: barWidth,
      height: barHeight,
      rotation: 0,
      content: "",
      fontSize: 1,
      fontWeight: 400,
      color: "transparent",
      textAlign: "center",
      fontFamily: "monospace",
      highlightBg: "#8cff05",
      highlightPaddingX: 0,
      highlightPaddingY: 0,
    };

    const icons: CarouselElement[] = [
      { id: createId(), type: "icon", x: startX + gap, y: startY + gap, width: iconSize, height: iconSize, rotation: 0, iconName: "thumbs-up", color: "#111111" },
      { id: createId(), type: "icon", x: startX + gap + iconSize + gap, y: startY + gap, width: iconSize, height: iconSize, rotation: 0, iconName: "message-circle", color: "#111111" },
      { id: createId(), type: "icon", x: startX + gap + (iconSize + gap) * 2, y: startY + gap, width: iconSize, height: iconSize, rotation: 0, iconName: "share-2", color: "#111111" },
    ];

    updateSlide({ elements: [...currentSlide.elements, bgEl, ...icons] });
    setSelectedElId(bgEl.id);
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

      // Grid pattern
      const patternColors = getPatternColors(slide.backgroundPattern);
      if (patternColors.lineColor) {
        ctx.strokeStyle = patternColors.lineColor;
        ctx.lineWidth = 2;
        for (let x = 0; x <= format.width; x += GRID_SIZE) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, format.height); ctx.stroke();
        }
        for (let y = 0; y <= format.height; y += GRID_SIZE) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(format.width, y); ctx.stroke();
        }
        // Corner accents
        const accentSize = 12;
        ctx.fillStyle = patternColors.accentColor!;
        ctx.fillRect(20, 20, accentSize, accentSize);
        ctx.fillRect(format.width - 20 - accentSize, 20, accentSize, accentSize);
        ctx.fillRect(20, format.height - 20 - accentSize, accentSize, accentSize);
        ctx.fillRect(format.width - 20 - accentSize, format.height - 20 - accentSize, accentSize, accentSize);
      }

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

        if (el.type === "highlight") {
          ctx.save();
          const px = el.highlightPaddingX || 24;
          const py = el.highlightPaddingY || 12;
          // Draw background
          ctx.fillStyle = el.highlightBg || "#8cff05";
          ctx.fillRect(el.x, el.y, el.width, el.height);
          // Draw text
          ctx.font = `${el.fontWeight || 900} ${el.fontSize || 48}px ${el.fontFamily || "monospace"}`;
          ctx.fillStyle = el.color || "#111111";
          ctx.textAlign = el.textAlign || "center";
          ctx.textBaseline = "middle";
          const textX = el.textAlign === "left" ? el.x + px : el.textAlign === "right" ? el.x + el.width - px : el.x + el.width / 2;
          ctx.fillText(el.content || "", textX, el.y + el.height / 2);
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

        if (el.type === "icon") {
          try {
            const iconSvg = await fetchLucideIconSvg(el.iconName || "star", el.color || "#ffffff");
            const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg)}`);
            ctx.drawImage(img, el.x, el.y, el.width, el.height);
          } catch {
            // skip broken icons
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
                          fontSize: (el.type === "text" || el.type === "highlight") ? el.fontSize : undefined,
                          fontWeight: (el.type === "text" || el.type === "highlight") ? el.fontWeight : undefined,
                          color: (el.type === "text" || el.type === "highlight") ? el.color : undefined,
                          textAlign: (el.type === "text" || el.type === "highlight") ? el.textAlign : undefined,
                          fontFamily: (el.type === "text" || el.type === "highlight") ? (el.fontFamily || "monospace") : undefined,
                          lineHeight: 1.3,
                          overflow: "hidden",
                          background: el.type === "highlight" ? (el.highlightBg || "#8cff05") : undefined,
                          display: el.type === "highlight" ? "flex" : undefined,
                          alignItems: el.type === "highlight" ? "center" : undefined,
                          justifyContent: el.type === "highlight" ? "center" : undefined,
                        }}
                      >
                        {(el.type === "text" || el.type === "highlight") ? el.content : null}
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
          <Button variant="outline" size="sm" onClick={() => addElement("highlight")}>
            <Highlighter className="h-3.5 w-3.5 mr-1.5" /> Highlight
          </Button>
          <Button variant="outline" size="sm" onClick={() => addElement("icon")}>
            <Smile className="h-3.5 w-3.5 mr-1.5" /> Ícone
          </Button>
          <Button variant="outline" size="sm" onClick={addSocialBlock}>
            <Heart className="h-3.5 w-3.5 mr-1.5" /> Like/Share
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
            {/* Grid overlay */}
            {currentSlide?.backgroundPattern && currentSlide.backgroundPattern !== "none" && (() => {
              const colors = getPatternColors(currentSlide.backgroundPattern);
              return (
                <>
                  <div style={{
                    position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0,
                    backgroundImage: `linear-gradient(${colors.lineColor} 2px, transparent 2px), linear-gradient(90deg, ${colors.lineColor} 2px, transparent 2px)`,
                    backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
                  }} />
                  <div style={{ position: "absolute", top: 20, left: 20, width: 12, height: 12, background: colors.accentColor!, pointerEvents: "none", zIndex: 0 }} />
                  <div style={{ position: "absolute", top: 20, right: 20, width: 12, height: 12, background: colors.accentColor!, pointerEvents: "none", zIndex: 0 }} />
                  <div style={{ position: "absolute", bottom: 20, left: 20, width: 12, height: 12, background: colors.accentColor!, pointerEvents: "none", zIndex: 0 }} />
                  <div style={{ position: "absolute", bottom: 20, right: 20, width: 12, height: 12, background: colors.accentColor!, pointerEvents: "none", zIndex: 0 }} />
                </>
              );
            })()}
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
        {/* Background pattern */}
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Padrão de Fundo</Label>
          <Select
            value={currentSlide?.backgroundPattern || "dark-grid"}
            onValueChange={(v) => {
              const pattern = v as BackgroundPattern;
              const colors = getPatternColors(pattern);
              updateSlide({
                backgroundPattern: pattern,
                ...(colors.bg ? { backgroundColor: colors.bg } : {}),
              });
            }}
          >
            <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="dark-grid">🖤 Escuro + Grid</SelectItem>
              <SelectItem value="light-grid">🤍 Claro + Grid</SelectItem>
              <SelectItem value="none">Sem padrão</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Slide background color */}
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Cor do Fundo</Label>
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

// For canvas export, we grab the rendered SVG from the DOM or build a simple one.
async function fetchLucideIconSvg(name: string, color: string): Promise<string> {
  // Try to find the icon already rendered in the DOM by its data attribute
  const svgEl = document.querySelector(`[data-lucide-icon="${name}"]`) as SVGElement | null;
  if (svgEl) {
    const clone = svgEl.cloneNode(true) as SVGElement;
    clone.setAttribute("width", "256");
    clone.setAttribute("height", "256");
    clone.querySelectorAll("*").forEach(el => {
      if (el.getAttribute("stroke") === "currentColor") el.setAttribute("stroke", color);
    });
    return new XMLSerializer().serializeToString(clone);
  }
  // Fallback: dynamically import from lucide-react and serialize
  try {
    const iconModule = await import("lucide-react");
    const icons = (iconModule as any).icons || {};
    // Convert kebab-case to PascalCase
    const pascal = name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("");
    if (icons[pascal]) {
      // icons[pascal] is an array of [tag, attrs, children] - not directly usable
      // Use a simple SVG template instead
    }
  } catch { /* noop */ }
  // Simple fallback SVG using known icon paths
  const ICON_PATHS: Record<string, string> = {
    "thumbs-up": '<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>',
    "message-circle": '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    "share-2": '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>',
    "heart": '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    "star": '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  };
  const path = ICON_PATHS[name] || '<circle cx="12" cy="12" r="10"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}
