import type { CarouselElement } from "./types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";

const POPULAR_ICONS = [
  "star", "heart", "thumbs-up", "thumbs-down", "message-circle", "share-2",
  "send", "bookmark", "bell", "check", "x", "plus", "minus", "arrow-right",
  "arrow-left", "play", "pause", "volume-2", "mic", "camera", "image",
  "download", "upload", "link", "globe", "user", "users", "settings",
  "search", "eye", "trophy", "zap", "flame", "sparkles", "shield",
  "lock", "unlock", "mail", "phone", "map-pin", "calendar", "clock",
  "gift", "award", "target", "trending-up", "bar-chart", "pie-chart",
];

interface Props {
  element: CarouselElement;
  onUpdate: (updates: Partial<CarouselElement>) => void;
  onDelete: () => void;
}

export function ElementPropertiesPanel({ element, onUpdate, onDelete }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onUpdate({ imageUrl: reader.result as string });
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-3 p-3 rounded border border-border bg-card text-sm">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {element.type === "text" ? "Texto" : element.type === "highlight" ? "Highlight" : "Imagem"}
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {(element.type === "text" || element.type === "highlight") && (
        <>
          <div className="space-y-1">
            <Label className="text-xs">Conteúdo</Label>
            <Textarea
              value={element.content || ""}
              onChange={(e) => onUpdate({ content: e.target.value })}
              rows={element.type === "highlight" ? 1 : 3}
              className="text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Tamanho</Label>
              <Input
                type="number"
                value={element.fontSize || 32}
                onChange={(e) => onUpdate({ fontSize: parseInt(e.target.value) || 32 })}
                className="text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Peso</Label>
              <Select
                value={String(element.fontWeight || 400)}
                onValueChange={(v) => onUpdate({ fontWeight: parseInt(v) })}
              >
                <SelectTrigger className="text-xs h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="300">Light</SelectItem>
                  <SelectItem value="400">Normal</SelectItem>
                  <SelectItem value="700">Bold</SelectItem>
                  <SelectItem value="900">Black</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Cor do Texto</Label>
              <div className="flex gap-1">
                <input
                  type="color"
                  value={element.color || "#ffffff"}
                  onChange={(e) => onUpdate({ color: e.target.value })}
                  className="w-9 h-9 rounded cursor-pointer border-0 p-0"
                />
                <Input
                  value={element.color || "#ffffff"}
                  onChange={(e) => onUpdate({ color: e.target.value })}
                  className="text-xs flex-1"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Alinhamento</Label>
              <Select
                value={element.textAlign || "left"}
                onValueChange={(v) => onUpdate({ textAlign: v as any })}
              >
                <SelectTrigger className="text-xs h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="left">Esquerda</SelectItem>
                  <SelectItem value="center">Centro</SelectItem>
                  <SelectItem value="right">Direita</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {element.type === "highlight" && (
            <div className="space-y-1">
              <Label className="text-xs">Cor do Fundo</Label>
              <div className="flex gap-1">
                <input
                  type="color"
                  value={element.highlightBg || "#8cff05"}
                  onChange={(e) => onUpdate({ highlightBg: e.target.value })}
                  className="w-9 h-9 rounded cursor-pointer border-0 p-0"
                />
                <Input
                  value={element.highlightBg || "#8cff05"}
                  onChange={(e) => onUpdate({ highlightBg: e.target.value })}
                  className="text-xs flex-1"
                />
              </div>
            </div>
          )}
        </>
      )}

      {element.type === "image" && (
        <>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
          <Button variant="outline" size="sm" className="w-full" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            {element.imageUrl ? "Trocar imagem" : "Carregar imagem"}
          </Button>
          {element.imageUrl && (
            <div className="space-y-1">
              <Label className="text-xs">Ajuste</Label>
              <Select
                value={element.objectFit || "cover"}
                onValueChange={(v) => onUpdate({ objectFit: v as any })}
              >
                <SelectTrigger className="text-xs h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cover">Preencher</SelectItem>
                  <SelectItem value="contain">Encaixar</SelectItem>
                  <SelectItem value="fill">Esticar</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </>
      )}

      {/* Position */}
      <div className="grid grid-cols-4 gap-1.5">
        {[
          { label: "X", key: "x" as const },
          { label: "Y", key: "y" as const },
          { label: "W", key: "width" as const },
          { label: "H", key: "height" as const },
        ].map(({ label, key }) => (
          <div key={key} className="space-y-0.5">
            <Label className="text-[10px] text-muted-foreground">{label}</Label>
            <Input
              type="number"
              value={element[key]}
              onChange={(e) => onUpdate({ [key]: parseInt(e.target.value) || 0 })}
              className="text-xs h-7 px-1.5"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
