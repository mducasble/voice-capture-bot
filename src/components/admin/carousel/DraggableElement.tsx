import { useRef, useCallback, useState, lazy, Suspense } from "react";
import type { CarouselElement } from "./types";
import dynamicIconImports from "lucide-react/dynamicIconImports";
import type { LucideProps } from "lucide-react";

interface Props {
  element: CarouselElement;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<CarouselElement>) => void;
  scale: number;
}

export function DraggableElement({ element, isSelected, onSelect, onUpdate, scale }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, elX: 0, elY: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect();
      setDragging(true);
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        elX: element.x,
        elY: element.y,
      };

      const handleMove = (ev: MouseEvent) => {
        const dx = (ev.clientX - dragStart.current.x) / scale;
        const dy = (ev.clientY - dragStart.current.y) / scale;
        onUpdate({
          x: Math.round(dragStart.current.elX + dx),
          y: Math.round(dragStart.current.elY + dy),
        });
      };

      const handleUp = () => {
        setDragging(false);
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [element.x, element.y, scale, onSelect, onUpdate]
  );

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setResizing(true);
      resizeStart.current = {
        x: e.clientX,
        y: e.clientY,
        w: element.width,
        h: element.height,
      };

      const handleMove = (ev: MouseEvent) => {
        const dx = (ev.clientX - resizeStart.current.x) / scale;
        const dy = (ev.clientY - resizeStart.current.y) / scale;
        onUpdate({
          width: Math.max(40, Math.round(resizeStart.current.w + dx)),
          height: Math.max(30, Math.round(resizeStart.current.h + dy)),
        });
      };

      const handleUp = () => {
        setResizing(false);
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [element.width, element.height, scale, onUpdate]
  );

  return (
    <div
      ref={elRef}
      onMouseDown={handleMouseDown}
      style={{
        position: "absolute",
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        cursor: dragging ? "grabbing" : "grab",
        outline: isSelected ? "2px solid #8cff05" : "1px dashed transparent",
        outlineOffset: 2,
        zIndex: isSelected ? 10 : 1,
        userSelect: "none",
      }}
    >
      {element.type === "text" && (
        <div
          style={{
            width: "100%",
            height: "100%",
            fontSize: element.fontSize || 32,
            fontWeight: element.fontWeight || 400,
            color: element.color || "#ffffff",
            textAlign: element.textAlign || "left",
            fontFamily: element.fontFamily || "monospace",
            lineHeight: 1.3,
            overflow: "hidden",
            wordBreak: "break-word",
            whiteSpace: "pre-wrap",
          }}
        >
          {element.content || "Texto"}
        </div>
      )}

      {element.type === "highlight" && (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: element.highlightBg || "#8cff05",
            display: "flex",
            alignItems: "center",
            justifyContent: element.textAlign === "left" ? "flex-start" : element.textAlign === "right" ? "flex-end" : "center",
            padding: `${element.highlightPaddingY || 12}px ${element.highlightPaddingX || 24}px`,
            fontSize: element.fontSize || 48,
            fontWeight: element.fontWeight || 900,
            color: element.color || "#111111",
            fontFamily: element.fontFamily || "monospace",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          {element.content || "HIGHLIGHT"}
        </div>
      )}

      {element.type === "image" && (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: element.imageUrl ? "transparent" : "rgba(255,255,255,0.1)",
            border: element.imageUrl ? "none" : "2px dashed rgba(255,255,255,0.3)",
            borderRadius: 4,
          }}
        >
          {element.imageUrl ? (
            <img
              src={element.imageUrl}
              alt=""
              style={{
                width: "100%",
                height: "100%",
                objectFit: element.objectFit || "cover",
                pointerEvents: "none",
              }}
              draggable={false}
            />
          ) : (
            <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 14 }}>Imagem</span>
          )}
        </div>
      )}

      {/* Resize handle */}
      {isSelected && (
        <div
          onMouseDown={handleResizeMouseDown}
          style={{
            position: "absolute",
            right: -5,
            bottom: -5,
            width: 10,
            height: 10,
            background: "#8cff05",
            cursor: "nwse-resize",
            zIndex: 20,
          }}
        />
      )}
    </div>
  );
}
