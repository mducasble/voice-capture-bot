import { useState, useEffect } from "react";
import { BookOpen, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTranslation } from "react-i18next";

const GUIDELINE_KEYS = [
  "environment", "audioQuality", "twoParticipants", "naturalConversation",
  "followTopic", "speechPace", "noPersonalData", "continuousRecording",
  "recordingDuration", "consistency",
];

export function RecordingGuidelinesSidebar() {
  const [open, setOpen] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    const timer = setTimeout(() => setOpen(false), 5000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`fixed right-0 top-1/2 -translate-y-1/2 z-40 flex items-center gap-2 py-6 px-3 font-mono text-[18px] font-black uppercase tracking-widest transition-all ${
          !open ? "animate-pulse" : ""
        }`}
        style={{
          background: "var(--portal-accent)",
          color: "var(--portal-accent-text)",
          writingMode: "vertical-rl",
          textOrientation: "mixed",
          borderRadius: "8px 0 0 8px",
          display: open ? "none" : "flex",
          boxShadow: !open ? "0 0 20px var(--portal-accent)" : "none",
        }}
      >
        <BookOpen className="h-6 w-6 rotate-90" />
        {t("guidelines.toggleButton")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity"
          onClick={() => setOpen(false)}
        />
      )}

      <div
        className="fixed top-0 right-0 h-full z-50 transition-transform duration-300 ease-in-out"
        style={{
          width: "380px",
          maxWidth: "90vw",
          transform: open ? "translateX(0)" : "translateX(100%)",
          background: "var(--portal-bg, #0a0a0a)",
          borderLeft: "1px solid var(--portal-border)",
        }}
      >
        <div
          className="flex items-center justify-between p-4"
          style={{ borderBottom: "1px solid var(--portal-border)" }}
        >
          <div className="flex items-center gap-3">
            <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
            <span
              className="font-mono text-xs font-bold uppercase tracking-[0.2em]"
              style={{ color: "var(--portal-text)" }}
            >
              {t("guidelines.title")}
            </span>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 transition-colors"
            style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ScrollArea className="h-[calc(100%-60px)]">
          <div className="p-4 space-y-3">
            {GUIDELINE_KEYS.map((key, i) => (
              <div
                key={key}
                className="p-3 space-y-1.5"
                style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="font-mono text-[10px] font-black w-5 h-5 flex items-center justify-center shrink-0"
                    style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}
                  >
                    {i + 1}
                  </span>
                  <span
                    className="font-mono text-xs font-bold uppercase tracking-wide"
                    style={{ color: "var(--portal-text)" }}
                  >
                    {t(`guidelines.items.${key}.title`)}
                  </span>
                </div>
                <p
                  className="font-mono text-[11px] leading-relaxed pl-7"
                  style={{ color: "var(--portal-text-muted)" }}
                >
                  {t(`guidelines.items.${key}.text`)}
                </p>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    </>
  );
}