import { useState, useEffect } from "react";
import { useMaintenance } from "@/hooks/useMaintenance";
import { AlertTriangle, Wrench } from "lucide-react";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useTranslation } from "react-i18next";
import kgenLogo from "@/assets/kgen-logo-green.png";

function formatCountdown(diff: number) {
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = Math.floor(diff % 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export function MaintenanceBanner() {
  const { data: config, error } = useMaintenance();
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (error || !config?.is_active || !config.scheduled_at) return null;

  const scheduledMs = new Date(config.scheduled_at).getTime();
  const diffSec = Math.max(0, Math.floor((scheduledMs - now) / 1000));
  const isDown = diffSec <= 0;

  if (isDown) return null;

  return (
    <div
      className="w-full py-4 px-6 flex items-center justify-center gap-3 text-base font-mono tracking-wide z-[100] animate-pulse"
      style={{
        background: "linear-gradient(90deg, hsl(45 100% 50%), hsl(30 100% 50%))",
        color: "hsl(0 0% 10%)",
      }}
    >
      <AlertTriangle className="h-5 w-5 shrink-0" />
      <span className="font-bold uppercase">
        {t("maintenance.bannerTitle")} {formatCountdown(diffSec)}
      </span>
      {config.message && <span className="hidden sm:inline">— {config.message}</span>}
    </div>
  );
}

export function MaintenanceBlock({ children }: { children: React.ReactNode }) {
  const { data: config, error } = useMaintenance();
  const { isAdmin } = useAdminAuth();
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (error || !config?.is_active || !config.scheduled_at) return <>{children}</>;

  const scheduledMs = new Date(config.scheduled_at).getTime();
  const isDown = now >= scheduledMs;

  if (!isDown) return <>{children}</>;
  if (isAdmin) return <>{children}</>;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-8" style={{ background: "hsl(0 0% 5%)" }}>
      <img src={kgenLogo} alt="KGen" className="h-12 mb-2" />
      <Wrench className="h-16 w-16" style={{ color: "hsl(45 100% 50%)" }} />
      <h1 className="text-3xl font-mono font-black uppercase tracking-widest" style={{ color: "hsl(0 0% 95%)" }}>
        {t("maintenance.blockTitle")}
      </h1>
      <p className="text-lg text-center max-w-md" style={{ color: "hsl(0 0% 60%)" }}>
        {config.message || t("maintenance.blockMessage")}
      </p>
      {config.estimated_duration_minutes && config.estimated_duration_minutes > 0 && (
        <div className="mt-4 px-4 py-2 rounded font-mono text-sm" style={{ background: "hsl(0 0% 12%)", color: "hsl(0 0% 50%)" }}>
          {t("maintenance.forecast")}: {Math.floor(config.estimated_duration_minutes / 60) > 0 ? `${Math.floor(config.estimated_duration_minutes / 60)}h ` : ""}{config.estimated_duration_minutes % 60}min
        </div>
      )}
    </div>
  );
}
