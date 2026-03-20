import { useTranslation } from "react-i18next";
import { useState, useRef, useEffect } from "react";

const LANGUAGES = [
  { code: "pt", flag: "https://flagcdn.com/w80/br.png", label: "Português" },
  { code: "es", flag: "https://flagcdn.com/w80/es.png", label: "Español" },
  { code: "en", flag: "https://flagcdn.com/w80/us.png", label: "English" },
];

export default function LanguageSelector({ variant = "flags" }: { variant?: "flags" | "compact" }) {
  const { i18n } = useTranslation();
  const currentLang = i18n.language?.substring(0, 2) || "pt";
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = LANGUAGES.find(l => l.code === currentLang) || LANGUAGES[0];
  const others = LANGUAGES.filter(l => l.code !== currentLang);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const size = variant === "compact" ? "w-7 h-7" : "w-10 h-10";
  const imgSize = variant === "compact" ? "w-5" : "w-7";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`${size} flex items-center justify-center overflow-hidden transition-all`}
        style={{
          border: "2px solid var(--portal-accent)",
          background: "transparent",
        }}
        title={current.label}
      >
        <img src={current.flag} alt={current.label} className={`${imgSize} h-auto`} />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 flex flex-col gap-1 z-50 p-1"
          style={{ background: "var(--portal-card-bg)", border: "1px solid var(--portal-border)" }}
        >
          {others.map(l => (
            <button
              key={l.code}
              type="button"
              onClick={() => { i18n.changeLanguage(l.code); setOpen(false); }}
              className={`${size} flex items-center justify-center overflow-hidden transition-all`}
              style={{
                border: "1px solid var(--portal-border)",
                background: "transparent",
              }}
              title={l.label}
            >
              <img src={l.flag} alt={l.label} className={`${imgSize} h-auto`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
