import { useTranslation } from "react-i18next";

const LANGUAGES = [
  { code: "pt", flag: "https://flagcdn.com/w80/br.png", label: "Português" },
  { code: "es", flag: "https://flagcdn.com/w80/es.png", label: "Español" },
  { code: "en", flag: "https://flagcdn.com/w80/us.png", label: "English" },
];

export default function LanguageSelector({ variant = "flags" }: { variant?: "flags" | "compact" }) {
  const { i18n } = useTranslation();
  const currentLang = i18n.language?.substring(0, 2) || "pt";

  if (variant === "compact") {
    return (
      <div className="flex items-center gap-1">
        {LANGUAGES.map(l => (
          <button
            key={l.code}
            type="button"
            onClick={() => i18n.changeLanguage(l.code)}
            className="w-7 h-7 flex items-center justify-center overflow-hidden transition-all"
            style={{
              border: currentLang === l.code ? "2px solid var(--portal-accent)" : "1px solid var(--portal-border)",
              background: "transparent",
            }}
            title={l.label}
          >
            <img src={l.flag} alt={l.label} className="w-5 h-auto" />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {LANGUAGES.map(l => (
        <button
          key={l.code}
          type="button"
          onClick={() => i18n.changeLanguage(l.code)}
          className="w-10 h-10 flex items-center justify-center cursor-pointer overflow-hidden transition-all"
          style={{
            border: currentLang === l.code ? "2px solid var(--portal-accent)" : "1px solid var(--portal-border)",
            background: "var(--portal-input-bg)",
          }}
          title={l.label}
        >
          <img src={l.flag} alt={l.label} className="w-7 h-auto" />
        </button>
      ))}
    </div>
  );
}
