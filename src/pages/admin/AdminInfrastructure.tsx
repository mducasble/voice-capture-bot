import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Server, Cloud, Cpu, Save, RefreshCw, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface InfraConfig {
  id: string;
  job_type: string;
  provider: string;
  provider_url: string | null;
  provider_api_key: string | null;
  is_enabled: boolean;
  notes: string | null;
  updated_at: string;
}

const PROVIDERS = [
  { value: "local", label: "Local (Máquina)", icon: Cpu, color: "text-emerald-400" },
  { value: "huggingface", label: "HuggingFace Space", icon: Cloud, color: "text-blue-400" },
  { value: "cloud_api", label: "Cloud API", icon: Server, color: "text-purple-400" },
];

const JOB_TYPE_LABELS: Record<string, string> = {
  analyze: "Análise de Métricas",
  enhance: "Melhoria de Áudio",
};

export default function AdminInfrastructure() {
  const [configs, setConfigs] = useState<InfraConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [newJobType, setNewJobType] = useState("");

  const loadConfigs = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("infrastructure_config")
      .select("*")
      .order("job_type");
    setLoading(false);
    if (error) { toast.error("Erro ao carregar configurações"); return; }
    setConfigs((data as any[]) || []);
  };

  useEffect(() => { loadConfigs(); }, []);

  const handleSave = async (config: InfraConfig) => {
    setSaving(prev => ({ ...prev, [config.id]: true }));
    const { error } = await supabase
      .from("infrastructure_config")
      .update({
        provider: config.provider,
        provider_url: config.provider_url,
        provider_api_key: config.provider_api_key,
        is_enabled: config.is_enabled,
        notes: config.notes,
      })
      .eq("id", config.id);
    setSaving(prev => ({ ...prev, [config.id]: false }));
    if (error) { toast.error("Erro ao salvar"); return; }
    toast.success(`Configuração de "${JOB_TYPE_LABELS[config.job_type] || config.job_type}" salva!`);
  };

  const handleAdd = async () => {
    if (!newJobType.trim()) return;
    const { error } = await supabase
      .from("infrastructure_config")
      .insert({ job_type: newJobType.trim().toLowerCase(), provider: "huggingface" } as any);
    if (error) { toast.error(error.message); return; }
    setNewJobType("");
    toast.success("Tipo de job adicionado!");
    loadConfigs();
  };

  const handleDelete = async (id: string, jobType: string) => {
    if (!confirm(`Remover configuração "${jobType}"?`)) return;
    const { error } = await supabase.from("infrastructure_config").delete().eq("id", id);
    if (error) { toast.error("Erro ao remover"); return; }
    toast.success("Removido!");
    loadConfigs();
  };

  const updateLocal = (id: string, updates: Partial<InfraConfig>) => {
    setConfigs(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[28px] font-bold text-foreground">Infraestrutura</h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          Configure qual provedor de processamento será usado para cada tipo de job.
        </p>
      </div>

      <div className="space-y-6">
        {configs.map((config) => {
          const providerInfo = PROVIDERS.find(p => p.value === config.provider);
          const ProviderIcon = providerInfo?.icon || Server;

          return (
            <div
              key={config.id}
              className={cn(
                "rounded-2xl border p-6 transition-all",
                config.is_enabled
                  ? "bg-card border-border"
                  : "bg-muted/30 border-border/50 opacity-70"
              )}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className={cn("h-11 w-11 rounded-xl flex items-center justify-center", 
                    config.is_enabled ? "bg-primary/10" : "bg-muted"
                  )}>
                    <ProviderIcon className={cn("h-5 w-5", providerInfo?.color || "text-muted-foreground")} />
                  </div>
                  <div>
                    <h3 className="text-[18px] font-bold text-foreground">
                      {JOB_TYPE_LABELS[config.job_type] || config.job_type}
                    </h3>
                    <span className="text-[13px] text-muted-foreground font-mono">job_type: {config.job_type}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] text-muted-foreground">Ativo</span>
                    <Switch
                      checked={config.is_enabled}
                      onCheckedChange={(v) => updateLocal(config.id, { is_enabled: v })}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(config.id, config.job_type)}
                    className="h-9 w-9 p-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Config fields */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="text-[12px] font-semibold uppercase text-muted-foreground mb-1.5 block">
                    Provedor
                  </label>
                  <Select
                    value={config.provider}
                    onValueChange={(v) => updateLocal(config.id, { provider: v })}
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROVIDERS.map(p => (
                        <SelectItem key={p.value} value={p.value}>
                          <span className="flex items-center gap-2">
                            <p.icon className={cn("h-4 w-4", p.color)} />
                            {p.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-[12px] font-semibold uppercase text-muted-foreground mb-1.5 block">
                    URL do Provedor
                  </label>
                  <Input
                    value={config.provider_url || ""}
                    onChange={(e) => updateLocal(config.id, { provider_url: e.target.value || null })}
                    placeholder="https://..."
                    className="h-11"
                  />
                </div>

                <div>
                  <label className="text-[12px] font-semibold uppercase text-muted-foreground mb-1.5 block">
                    API Key
                  </label>
                  <Input
                    type="password"
                    value={config.provider_api_key || ""}
                    onChange={(e) => updateLocal(config.id, { provider_api_key: e.target.value || null })}
                    placeholder="Opcional"
                    className="h-11"
                  />
                </div>
              </div>

              <div className="mb-4">
                <label className="text-[12px] font-semibold uppercase text-muted-foreground mb-1.5 block">
                  Notas
                </label>
                <Input
                  value={config.notes || ""}
                  onChange={(e) => updateLocal(config.id, { notes: e.target.value || null })}
                  placeholder="Descrição ou observações..."
                  className="h-11"
                />
              </div>

              {/* Save */}
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-muted-foreground">
                  Atualizado: {new Date(config.updated_at).toLocaleString("pt-BR")}
                </span>
                <Button
                  onClick={() => handleSave(config)}
                  disabled={saving[config.id]}
                  className="gap-2"
                >
                  {saving[config.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Salvar
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add new job type */}
      <div className="rounded-2xl border border-dashed border-border p-6">
        <h3 className="text-[16px] font-semibold text-foreground mb-3">Adicionar novo tipo de job</h3>
        <div className="flex items-center gap-3">
          <Input
            value={newJobType}
            onChange={(e) => setNewJobType(e.target.value)}
            placeholder="Ex: transcribe, classify..."
            className="h-11 max-w-xs"
          />
          <Button onClick={handleAdd} disabled={!newJobType.trim()} className="gap-2 h-11">
            <Plus className="h-4 w-4" />
            Adicionar
          </Button>
        </div>
      </div>
    </div>
  );
}
