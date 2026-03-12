import { useState, useEffect } from "react";
import { useMaintenance, CONFIG_ID } from "@/hooks/useMaintenance";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Wrench, Power, Clock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const QUICK_OPTIONS = [
  { label: "5 min", minutes: 5 },
  { label: "15 min", minutes: 15 },
  { label: "30 min", minutes: 30 },
  { label: "1 hora", minutes: 60 },
];

export default function AdminMaintenance() {
  const { data: config, isLoading } = useMaintenance();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [customMinutes, setCustomMinutes] = useState("15");
  const [estimatedHours, setEstimatedHours] = useState("0");
  const [estimatedMinutes, setEstimatedMinutes] = useState("30");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (config) {
      setMessage(config.message || "");
    }
  }, [config]);

  const scheduleIn = async (minutes: number) => {
    setSaving(true);
    const scheduledAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    const estDuration = (parseInt(estimatedHours) || 0) * 60 + (parseInt(estimatedMinutes) || 0);
    const { error } = await supabase
      .from("maintenance_config")
      .update({
        is_active: true,
        scheduled_at: scheduledAt,
        message: message || null,
        estimated_duration_minutes: estDuration > 0 ? estDuration : null,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", CONFIG_ID);
    setSaving(false);
    if (error) {
      toast.error("Erro ao agendar manutenção");
      console.error(error);
    } else {
      toast.success(`Manutenção agendada para daqui ${minutes} minutos`);
      queryClient.invalidateQueries({ queryKey: ["maintenance-config"] });
    }
  };

  const cancel = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("maintenance_config")
      .update({
        is_active: false,
        scheduled_at: null,
        message: null,
        estimated_duration_minutes: null,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", CONFIG_ID);
    setSaving(false);
    if (error) {
      toast.error("Erro ao cancelar");
    } else {
      toast.success("Manutenção cancelada");
      queryClient.invalidateQueries({ queryKey: ["maintenance-config"] });
    }
  };

  if (isLoading) return <div className="p-8 text-muted-foreground">Carregando...</div>;

  const isActive = config?.is_active && config?.scheduled_at;
  const scheduledDate = config?.scheduled_at ? new Date(config.scheduled_at) : null;
  const isDown = scheduledDate && Date.now() >= scheduledDate.getTime();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Wrench className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Modo Manutenção</h1>
      </div>

      {/* Current Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Power className="h-5 w-5" />
            Status Atual
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isActive ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${isDown ? "bg-red-500" : "bg-yellow-500 animate-pulse"}`} />
                <span className="font-semibold">
                  {isDown ? "Site bloqueado (em manutenção)" : "Manutenção agendada"}
                </span>
              </div>
              {scheduledDate && (
                <p className="text-sm text-muted-foreground">
                  Agendado para: {scheduledDate.toLocaleString("pt-BR")}
                </p>
              )}
              {config?.message && (
                <p className="text-sm text-muted-foreground">Mensagem: {config.message}</p>
              )}
              <Button variant="destructive" onClick={cancel} disabled={saving}>
                Cancelar Manutenção
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="text-muted-foreground">Site operando normalmente</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Schedule */}
      {!isActive && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Agendar Manutenção
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Tempo estimado de manutenção</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  value={estimatedHours}
                  onChange={(e) => setEstimatedHours(e.target.value)}
                  className="w-20"
                />
                <span className="text-sm text-muted-foreground">h</span>
                <Input
                  type="number"
                  min="0"
                  max="59"
                  value={estimatedMinutes}
                  onChange={(e) => setEstimatedMinutes(e.target.value)}
                  className="w-20"
                />
                <span className="text-sm text-muted-foreground">min</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Mensagem para os usuários (opcional)</Label>
              <Input
                placeholder="Ex: Atualizações de sistema em andamento"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Atalhos rápidos</Label>
              <div className="flex flex-wrap gap-2">
                {QUICK_OPTIONS.map((opt) => (
                  <Button
                    key={opt.minutes}
                    variant="outline"
                    onClick={() => scheduleIn(opt.minutes)}
                    disabled={saving}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Ou tempo personalizado (minutos)</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min="1"
                  value={customMinutes}
                  onChange={(e) => setCustomMinutes(e.target.value)}
                  className="w-32"
                />
                <Button
                  onClick={() => scheduleIn(parseInt(customMinutes) || 15)}
                  disabled={saving}
                >
                  Agendar
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
