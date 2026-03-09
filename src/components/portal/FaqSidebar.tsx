import { useState } from "react";
import { HelpCircle, X, ChevronDown, ChevronUp } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface FaqItem {
  id: string;
  category: string;
  sort_order: number;
  question_pt: string;
  question_en: string | null;
  question_es: string | null;
  answer_pt: string;
  answer_en: string | null;
  answer_es: string | null;
}

export function FaqSidebar() {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { i18n, t } = useTranslation();

  const { data: items = [] } = useQuery({
    queryKey: ["portal-faq"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("faq_items")
        .select("*")
        .eq("is_active", true)
        .order("category")
        .order("sort_order");
      if (error) throw error;
      return data as FaqItem[];
    },
  });

  const lang = i18n.language?.startsWith("es") ? "es" : i18n.language?.startsWith("en") ? "en" : "pt";

  const getQuestion = (item: FaqItem) => {
    if (lang === "en" && item.question_en) return item.question_en;
    if (lang === "es" && item.question_es) return item.question_es;
    return item.question_pt;
  };

  const getAnswer = (item: FaqItem) => {
    if (lang === "en" && item.answer_en) return item.answer_en;
    if (lang === "es" && item.answer_es) return item.answer_es;
    return item.answer_pt;
  };

  // Group by category
  const grouped = items.reduce<Record<string, FaqItem[]>>((acc, item) => {
    (acc[item.category] = acc[item.category] || []).push(item);
    return acc;
  }, {});

  if (items.length === 0) return null;

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-40 flex items-center gap-2 py-6 px-3 font-mono text-[16px] font-black uppercase tracking-widest transition-all"
        style={{
          background: "var(--portal-accent)",
          color: "var(--portal-accent-text)",
          writingMode: "vertical-rl",
          textOrientation: "mixed",
          borderRadius: "8px 0 0 8px",
          display: open ? "none" : "flex",
          boxShadow: "0 0 15px var(--portal-accent)",
        }}
      >
        <HelpCircle className="h-5 w-5 rotate-90" />
        {t("faq.toggleButton")}
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Panel */}
      <div
        className="fixed top-0 right-0 h-full z-50 transition-transform duration-300 ease-in-out"
        style={{
          width: "400px",
          maxWidth: "90vw",
          transform: open ? "translateX(0)" : "translateX(100%)",
          background: "var(--portal-bg, #0a0a0a)",
          borderLeft: "1px solid var(--portal-border)",
        }}
      >
        {/* Header */}
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
              {t("faq.title")}
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

        {/* Content */}
        <ScrollArea className="h-[calc(100%-60px)]">
          <div className="p-4 space-y-5">
            {Object.entries(grouped).map(([category, catItems]) => (
              <div key={category} className="space-y-2">
              <p
                  className="font-mono text-xs font-bold uppercase tracking-[0.3em]"
                  style={{ color: "var(--portal-accent)" }}
                >
                  {category}
                </p>
                <div className="space-y-1.5">
                  {catItems.map((item) => {
                    const isExpanded = expandedId === item.id;
                    return (
                      <div
                        key={item.id}
                        style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}
                      >
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : item.id)}
                          className="w-full p-3 flex items-start gap-2 text-left"
                        >
                          <span className="flex-1 font-mono text-sm font-bold leading-relaxed" style={{ color: "var(--portal-text)" }}>
                            {getQuestion(item)}
                          </span>
                          {isExpanded ? (
                            <ChevronUp className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: "var(--portal-text-muted)" }} />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: "var(--portal-text-muted)" }} />
                          )}
                        </button>
                        {isExpanded && (
                          <div className="px-3 pb-3">
                            <div className="w-full h-px mb-2" style={{ background: "var(--portal-border)" }} />
                            <p
                              className="font-mono text-[11px] leading-relaxed whitespace-pre-line"
                              style={{ color: "var(--portal-text-muted)" }}
                            >
                              {getAnswer(item)}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    </>
  );
}