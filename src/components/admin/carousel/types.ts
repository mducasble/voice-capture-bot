export interface CarouselElement {
  id: string;
  type: "text" | "image";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  // Text props
  content?: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  textAlign?: "left" | "center" | "right";
  fontFamily?: string;
  // Image props
  imageUrl?: string;
  objectFit?: "cover" | "contain" | "fill";
}

export type BackgroundPattern = "none" | "dark-grid" | "light-grid";

export interface CarouselSlide {
  id: string;
  elements: CarouselElement[];
  backgroundColor: string;
  backgroundGradient?: string;
  backgroundPattern: BackgroundPattern;
}

export interface CarouselProject {
  slides: CarouselSlide[];
  format: CarouselFormat;
}

export interface CarouselFormat {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const CAROUSEL_FORMATS: CarouselFormat[] = [
  { id: "instagram", label: "Instagram (1080×1080)", width: 1080, height: 1080 },
  { id: "linkedin", label: "LinkedIn (1080×1350)", width: 1080, height: 1350 },
];

export const CAROUSEL_TEMPLATES: {
  id: string;
  label: string;
  slides: Omit<CarouselSlide, "id">[];
}[] = [
  {
    id: "blank",
    label: "Em branco",
    slides: [{ elements: [], backgroundColor: "#111111", backgroundPattern: "dark-grid" }],
  },
  {
    id: "title-body",
    label: "Título + Corpo",
    slides: [
      {
        elements: [
          {
            id: "t1",
            type: "text",
            x: 80,
            y: 200,
            width: 920,
            height: 120,
            rotation: 0,
            content: "TÍTULO AQUI",
            fontSize: 72,
            fontWeight: 900,
            color: "#8cff05",
            textAlign: "left",
            fontFamily: "monospace",
          },
          {
            id: "t2",
            type: "text",
            x: 80,
            y: 380,
            width: 920,
            height: 400,
            rotation: 0,
            content: "Adicione o corpo do texto aqui. Clique para editar.",
            fontSize: 36,
            fontWeight: 400,
            color: "#eaeaea",
            textAlign: "left",
            fontFamily: "monospace",
          },
        ],
        backgroundColor: "#111111",
        backgroundPattern: "dark-grid",
      },
      {
        elements: [
          {
            id: "t3",
            type: "text",
            x: 80,
            y: 200,
            width: 920,
            height: 120,
            rotation: 0,
            content: "SLIDE 2",
            fontSize: 72,
            fontWeight: 900,
            color: "#8cff05",
            textAlign: "left",
            fontFamily: "monospace",
          },
          {
            id: "t4",
            type: "text",
            x: 80,
            y: 380,
            width: 920,
            height: 400,
            rotation: 0,
            content: "Continue seu conteúdo aqui.",
            fontSize: 36,
            fontWeight: 400,
            color: "#eaeaea",
            textAlign: "left",
            fontFamily: "monospace",
          },
        ],
        backgroundColor: "#111111",
        backgroundPattern: "dark-grid",
      },
    ],
  },
  {
    id: "impact",
    label: "Impacto Visual",
    slides: [
      {
        elements: [
          {
            id: "i1",
            type: "text",
            x: 60,
            y: 300,
            width: 960,
            height: 200,
            rotation: 0,
            content: "GRANDE IMPACTO",
            fontSize: 96,
            fontWeight: 900,
            color: "#ffffff",
            textAlign: "center",
            fontFamily: "monospace",
          },
          {
            id: "i2",
            type: "text",
            x: 200,
            y: 540,
            width: 680,
            height: 60,
            rotation: 0,
            content: "Subtítulo explicativo",
            fontSize: 32,
            fontWeight: 400,
            color: "#8cff05",
            textAlign: "center",
            fontFamily: "monospace",
          },
        ],
        backgroundColor: "#111111",
        backgroundGradient: "linear-gradient(135deg, #111111 0%, #1a1a2e 100%)",
        backgroundPattern: "dark-grid",
      },
    ],
  },
];

export function createId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export function createSlide(template?: Omit<CarouselSlide, "id">): CarouselSlide {
  const base = template || { elements: [], backgroundColor: "#111111", backgroundPattern: "dark-grid" as BackgroundPattern };
  return {
    ...base,
    backgroundPattern: base.backgroundPattern || "dark-grid",
    id: createId(),
    elements: base.elements.map((el) => ({ ...el, id: createId() })),
  };
}

export const GRID_SIZE = 60;
export const ACCENT_COLOR = "#8cff05";

export function getPatternColors(pattern: BackgroundPattern) {
  if (pattern === "dark-grid") {
    return { bg: "#111111", lineColor: "rgba(255,255,255,0.05)", accentColor: ACCENT_COLOR };
  }
  if (pattern === "light-grid") {
    return { bg: "#f5f5f5", lineColor: "rgba(0,0,0,0.06)", accentColor: ACCENT_COLOR };
  }
  return { bg: null, lineColor: null, accentColor: null };
}
