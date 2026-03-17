import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";

type Status = "pending" | "approved" | "rejected" | "alert" | string;

const config: Record<string, { bg: string; text: string; icon: typeof Clock; label: string }> = {
  pending: { bg: "bg-amber-500", text: "text-white", icon: Clock, label: "Pendente" },
  approved: { bg: "bg-emerald-600", text: "text-white", icon: CheckCircle2, label: "Aprovado" },
  rejected: { bg: "bg-red-600", text: "text-white", icon: XCircle, label: "Reprovado" },
  alert: { bg: "bg-orange-500", text: "text-white", icon: AlertTriangle, label: "Alerta" },
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const c = config[status] || config.pending;
  const Icon = c.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold", c.bg, c.text, className)}>
      <Icon className="h-4 w-4" />
      {c.label}
    </span>
  );
}
