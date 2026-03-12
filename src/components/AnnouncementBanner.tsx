import { useAnnouncements } from "@/hooks/useAnnouncements";
import { X, Info, AlertTriangle, CheckCircle, Megaphone, ExternalLink } from "lucide-react";

const typeConfig: Record<string, { bg: string; icon: typeof Info }> = {
  info: { bg: "linear-gradient(90deg, hsl(210 80% 50%), hsl(220 80% 40%))", icon: Info },
  warning: { bg: "linear-gradient(90deg, hsl(45 100% 50%), hsl(30 100% 50%))", icon: AlertTriangle },
  success: { bg: "linear-gradient(90deg, hsl(145 70% 40%), hsl(160 70% 35%))", icon: CheckCircle },
  promo: { bg: "linear-gradient(90deg, hsl(265 75% 55%), hsl(300 60% 50%))", icon: Megaphone },
};

export function AnnouncementBanners() {
  const { announcements, dismiss } = useAnnouncements();

  if (announcements.length === 0) return null;

  return (
    <div className="w-full z-[99] flex flex-col">
      {announcements.map((a) => {
        const config = typeConfig[a.announcement_type] || typeConfig.info;
        const Icon = config.icon;
        const isWarning = a.announcement_type === "warning";

        return (
          <div
            key={a.id}
            className="w-full py-3 px-4 sm:px-6 flex items-center gap-3 font-mono text-sm"
            style={{
              background: config.bg,
              color: isWarning ? "hsl(0 0% 10%)" : "hsl(0 0% 98%)",
            }}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <div className="flex-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-bold uppercase tracking-wide">{a.title}</span>
              {a.message && <span className="hidden sm:inline opacity-90">— {a.message}</span>}
              {a.link_url && (
                <a
                  href={a.link_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline underline-offset-2 font-semibold opacity-90 hover:opacity-100"
                >
                  {a.link_label || "Ver mais"}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <button
              onClick={() => dismiss(a.id)}
              className="p-1 rounded-sm opacity-70 hover:opacity-100 transition-opacity shrink-0"
              title="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
