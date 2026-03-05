import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, AlertTriangle, ChevronDown, ChevronUp, Copy } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  useCampaign, useClients, useCreateCampaign, useUpdateCampaign, useDeleteCampaign, useCreateClient, useTaskTypeCatalog,
} from "@/hooks/useCampaigns";
import type {
  GeographicScope, LanguageVariant, RewardConfig, QualityFlow, CampaignTaskSet, ValidationRule,
} from "@/lib/campaignTypes";
import {
  DEFAULT_REJECTION_REASONS, RULE_LABELS, TASK_TYPE_LABELS, TASK_TYPE_CATEGORIES,
} from "@/lib/campaignTypes";
import { toast } from "@/hooks/use-toast";

interface CampaignDialogProps {
  open: boolean;
  onClose: () => void;
  campaignId: string | null;
}

// Convert catalog default JSONB validation to ValidationRule[]
function catalogJsonToRules(json: Record<string, any>, scope: "technical" | "content"): ValidationRule[] {
  return Object.entries(json).map(([key, val]) => ({
    rule_key: key,
    validation_scope: scope,
    min_value: val.min_value ?? val.min_db ?? val.min_value_hz ?? val.min_score ?? val.min_width_px ?? null,
    max_value: val.max_value ?? val.max_db ?? val.max_width_px ?? null,
    target_value: val.target_value_hz ?? val.target_value ?? null,
    allowed_values: val.allowed_values_hz ?? val.allowed_values ?? val.values ?? null,
    config: val,
    is_critical: val.is_critical ?? false,
  }));
}

function createDefaultTaskSet(taskType: string, catalog: any[]): CampaignTaskSet {
  const cat = catalog.find(c => c.task_type === taskType);
  return {
    task_set_id: `set_${taskType}_${Date.now()}`,
    task_type: taskType,
    enabled: true,
    weight: 1,
    instructions_title: "",
    instructions_summary: "",
    prompt_topic: "",
    prompt_do: [],
    prompt_dont: [],
    admin_rules: cat?.default_admin_rules || {},
    tech_validation: cat ? catalogJsonToRules(cat.default_tech_validation, "technical") : [],
    content_validation: cat ? catalogJsonToRules(cat.default_content_validation, "content") : [],
  };
}

export function CampaignDialog({ open, onClose, campaignId }: CampaignDialogProps) {
  const { data: campaign, isLoading: loadingCampaign } = useCampaign(campaignId ?? undefined);
  const { data: clients } = useClients();
  const { data: catalog } = useTaskTypeCatalog();
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const deleteCampaign = useDeleteCampaign();
  const createClient = useCreateClient();

  // Campaign basic
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [clientId, setClientId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [targetHours, setTargetHours] = useState<number>(0);
  const [isActive, setIsActive] = useState(true);
  const [campaignStatus, setCampaignStatus] = useState("draft");
  const [durationUnit, setDurationUnit] = useState("days");
  const [durationValue, setDurationValue] = useState<number | undefined>();
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [visibilityIsPublic, setVisibilityIsPublic] = useState(false);
  const [partnerId, setPartnerId] = useState("");
  const [languagePrimary, setLanguagePrimary] = useState("pt-BR");

  // Geographic scope
  const [geoScope, setGeoScope] = useState<GeographicScope>({
    restriction_mode: "include", continents: [], countries: [], regions: [], states: [], cities: [],
  });

  // Language variants
  const [langVariants, setLangVariants] = useState<LanguageVariant[]>([]);

  // Task sets
  const [taskSets, setTaskSets] = useState<CampaignTaskSet[]>([]);
  const [expandedTaskSet, setExpandedTaskSet] = useState<number | null>(0);

  // Reward
  const [reward, setReward] = useState<RewardConfig>({
    currency: "USD", payout_model: "per_accepted_unit", base_rate: null, bonus_rate: null, bonus_condition: "",
  });

  // Quality flow
  const [quality, setQuality] = useState<QualityFlow>({
    review_mode: "hybrid", sampling_rate_value: 10, sampling_rate_unit: "percent",
    rejection_reasons: [...DEFAULT_REJECTION_REASONS],
  });

  // UI state
  const [newClientName, setNewClientName] = useState("");
  const [showNewClient, setShowNewClient] = useState(false);
  const [tempGeoField, setTempGeoField] = useState<Record<string, string>>({});

  // Load campaign
  useEffect(() => {
    if (campaign) {
      setName(campaign.name);
      setDescription(campaign.description || "");
      setClientId(campaign.client_id || "");
      setStartDate(campaign.start_date || "");
      setEndDate(campaign.end_date || "");
      setTargetHours(campaign.target_hours || 0);
      setIsActive(campaign.is_active ?? true);
      setCampaignStatus(campaign.campaign_status || "draft");
      setDurationUnit(campaign.duration_unit || "days");
      setDurationValue(campaign.duration_value ?? undefined);
      setTimezone(campaign.timezone || "America/Sao_Paulo");
      setVisibilityIsPublic(campaign.visibility_is_public ?? false);
      setPartnerId(campaign.partner_id || "");
      setLanguagePrimary(campaign.language_primary || "pt-BR");
      if (campaign.geographic_scope) setGeoScope(campaign.geographic_scope);
      if (campaign.language_variants?.length) setLangVariants(campaign.language_variants);
      if (campaign.task_sets?.length) setTaskSets(campaign.task_sets);
      if (campaign.reward_config) setReward(campaign.reward_config);
      if (campaign.quality_flow) setQuality(campaign.quality_flow);
    } else if (!campaignId) {
      setName(""); setDescription(""); setClientId(""); setStartDate(""); setEndDate("");
      setTargetHours(0); setIsActive(true); setCampaignStatus("draft");
      setDurationUnit("days"); setDurationValue(undefined);
      setTimezone("America/Sao_Paulo"); setVisibilityIsPublic(false); setPartnerId("");
      setLanguagePrimary("pt-BR");
      setGeoScope({ restriction_mode: "include", continents: [], countries: [], regions: [], states: [], cities: [] });
      setLangVariants([]);
      setTaskSets([]);
      setReward({ currency: "USD", payout_model: "per_accepted_unit", base_rate: null, bonus_rate: null, bonus_condition: "" });
      setQuality({ review_mode: "hybrid", sampling_rate_value: 10, sampling_rate_unit: "percent", rejection_reasons: [...DEFAULT_REJECTION_REASONS] });
    }
  }, [campaign, campaignId]);

  const handleSave = async () => {
    if (!name.trim()) { toast({ title: "Nome obrigatório", variant: "destructive" }); return; }
    try {
      const payload = {
        campaign: {
          name, description: description || null, client_id: clientId || null,
          start_date: startDate || null, end_date: endDate || null,
          target_hours: targetHours || null, is_active: isActive,
          campaign_type: taskSets.length > 0 ? taskSets[0].task_type : null,
          campaign_status: campaignStatus,
          duration_unit: durationUnit, duration_value: durationValue ?? null,
          timezone, visibility_is_public: visibilityIsPublic,
          partner_id: partnerId || null,
          schema_version: "campaign.v1",
          language_primary: languagePrimary || null,
        },
        geographic_scope: geoScope,
        language_variants: langVariants,
        task_sets: taskSets,
        reward_config: reward,
        quality_flow: quality,
      };
      if (campaignId) {
        await updateCampaign.mutateAsync({ id: campaignId, ...payload });
        toast({ title: "Campanha atualizada!" });
      } else {
        await createCampaign.mutateAsync(payload);
        toast({ title: "Campanha criada!" });
      }
      onClose();
    } catch (error) {
      toast({ title: "Erro ao salvar campanha", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!campaignId || !confirm("Tem certeza que deseja excluir esta campanha?")) return;
    try {
      await deleteCampaign.mutateAsync(campaignId);
      toast({ title: "Campanha excluída!" });
      onClose();
    } catch { toast({ title: "Erro ao excluir", variant: "destructive" }); }
  };

  const handleCreateClient = async () => {
    if (!newClientName.trim()) return;
    try {
      const nc = await createClient.mutateAsync({ name: newClientName });
      setClientId(nc.id);
      setNewClientName(""); setShowNewClient(false);
      toast({ title: "Cliente criado!" });
    } catch { toast({ title: "Erro ao criar cliente", variant: "destructive" }); }
  };

  const addGeoItem = (field: keyof GeographicScope, value: string) => {
    if (!value.trim()) return;
    setGeoScope(prev => ({ ...prev, [field]: [...(prev[field] as string[]), value.trim()] }));
    setTempGeoField(prev => ({ ...prev, [field]: "" }));
  };

  const removeGeoItem = (field: keyof GeographicScope, index: number) => {
    setGeoScope(prev => ({ ...prev, [field]: (prev[field] as string[]).filter((_, i) => i !== index) }));
  };

  const addTaskSet = (taskType: string) => {
    if (!catalog) return;
    const newTs = createDefaultTaskSet(taskType, catalog);
    setTaskSets(prev => [...prev, newTs]);
    setExpandedTaskSet(taskSets.length);
  };

  const removeTaskSet = (index: number) => {
    setTaskSets(prev => prev.filter((_, i) => i !== index));
    setExpandedTaskSet(null);
  };

  const updateTaskSet = (index: number, updates: Partial<CampaignTaskSet>) => {
    setTaskSets(prev => prev.map((ts, i) => i === index ? { ...ts, ...updates } : ts));
  };

  const updateTechRule = (tsIndex: number, ruleIndex: number, field: string, value: any) => {
    setTaskSets(prev => prev.map((ts, i) => {
      if (i !== tsIndex) return ts;
      const rules = [...(ts.tech_validation || [])];
      rules[ruleIndex] = { ...rules[ruleIndex], [field]: value };
      return { ...ts, tech_validation: rules };
    }));
  };

  const updateContentRule = (tsIndex: number, ruleIndex: number, field: string, value: any) => {
    setTaskSets(prev => prev.map((ts, i) => {
      if (i !== tsIndex) return ts;
      const rules = [...(ts.content_validation || [])];
      rules[ruleIndex] = { ...rules[ruleIndex], [field]: value };
      return { ...ts, content_validation: rules };
    }));
  };

  const isLoading = createCampaign.isPending || updateCampaign.isPending || deleteCampaign.isPending;

  const renderGeoField = (field: keyof GeographicScope, label: string) => {
    const items = geoScope[field] as string[];
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <div className="flex gap-2">
          <Input
            value={tempGeoField[field] || ""}
            onChange={e => setTempGeoField(prev => ({ ...prev, [field]: e.target.value }))}
            placeholder={`Adicionar ${label.toLowerCase()}`}
            onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addGeoItem(field, tempGeoField[field] || ""))}
          />
          <Button variant="outline" size="icon" onClick={() => addGeoItem(field, tempGeoField[field] || "")}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {items.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {items.map((item, i) => (
              <Badge key={i} variant="secondary" className="cursor-pointer" onClick={() => removeGeoItem(field, i)}>
                {item} ×
              </Badge>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderValidationRules = (rules: ValidationRule[], tsIndex: number, type: "tech" | "content") => {
    const updateFn = type === "tech" ? updateTechRule : updateContentRule;
    return (
      <div className="space-y-2">
        {rules.map((rule, i) => (
          <div key={rule.rule_key} className="grid grid-cols-[1fr_70px_70px_70px_50px] gap-2 items-center text-sm">
            <span className="truncate text-xs">{RULE_LABELS[rule.rule_key] || rule.rule_key}</span>
            <Input type="number" step="any" value={rule.min_value ?? ""} onChange={e => updateFn(tsIndex, i, "min_value", e.target.value ? parseFloat(e.target.value) : null)} placeholder="Mín" className="h-7 text-xs" />
            <Input type="number" step="any" value={rule.max_value ?? ""} onChange={e => updateFn(tsIndex, i, "max_value", e.target.value ? parseFloat(e.target.value) : null)} placeholder="Máx" className="h-7 text-xs" />
            <Input type="number" step="any" value={rule.target_value ?? ""} onChange={e => updateFn(tsIndex, i, "target_value", e.target.value ? parseFloat(e.target.value) : null)} placeholder="Alvo" className="h-7 text-xs" />
            <div className="flex items-center justify-center">
              <Switch checked={rule.is_critical} onCheckedChange={c => updateFn(tsIndex, i, "is_critical", c)} />
            </div>
          </div>
        ))}
        {rules.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">Nenhuma regra configurada</p>
        )}
      </div>
    );
  };

  const renderTaskSetCard = (ts: CampaignTaskSet, index: number) => {
    const isExpanded = expandedTaskSet === index;
    const category = TASK_TYPE_CATEGORIES[ts.task_type] || "audio";

    return (
      <div key={index} className="border rounded-lg overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50"
          onClick={() => setExpandedTaskSet(isExpanded ? null : index)}
        >
          <div className="flex items-center gap-2">
            <Badge variant={ts.enabled ? "default" : "outline"} className="text-xs">
              {TASK_TYPE_LABELS[ts.task_type] || ts.task_type}
            </Badge>
            <span className="text-xs text-muted-foreground">{ts.task_set_id}</span>
          </div>
          <div className="flex items-center gap-1">
            <Switch
              checked={ts.enabled}
              onCheckedChange={c => { updateTaskSet(index, { enabled: c }); }}
              onClick={e => e.stopPropagation()}
            />
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={e => { e.stopPropagation(); removeTaskSet(index); }}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>

        {/* Expanded content */}
        {isExpanded && (
          <div className="border-t p-3 space-y-4">
            {/* Instructions */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Instruções</Label>
              <Input value={ts.instructions_title || ""} onChange={e => updateTaskSet(index, { instructions_title: e.target.value })} placeholder="Título" className="h-8 text-xs" />
              <Textarea value={ts.instructions_summary || ""} onChange={e => updateTaskSet(index, { instructions_summary: e.target.value })} placeholder="Resumo" rows={2} className="text-xs" />
              <Input value={ts.prompt_topic || ""} onChange={e => updateTaskSet(index, { prompt_topic: e.target.value })} placeholder="Tópico do prompt" className="h-8 text-xs" />
            </div>

            {/* DO / DONT */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">O que FAZER</Label>
                <div className="flex gap-1">
                  <Input placeholder="Adicionar" className="h-7 text-xs" id={`do-${index}`}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const v = (e.target as HTMLInputElement).value.trim();
                        if (v) { updateTaskSet(index, { prompt_do: [...ts.prompt_do, v] }); (e.target as HTMLInputElement).value = ""; }
                      }
                    }}
                  />
                </div>
                <div className="flex flex-wrap gap-1">{ts.prompt_do.map((item, i) => (
                  <Badge key={i} variant="secondary" className="cursor-pointer text-xs" onClick={() => updateTaskSet(index, { prompt_do: ts.prompt_do.filter((_, ii) => ii !== i) })}>✅ {item} ×</Badge>
                ))}</div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">O que NÃO fazer</Label>
                <div className="flex gap-1">
                  <Input placeholder="Adicionar" className="h-7 text-xs" id={`dont-${index}`}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const v = (e.target as HTMLInputElement).value.trim();
                        if (v) { updateTaskSet(index, { prompt_dont: [...ts.prompt_dont, v] }); (e.target as HTMLInputElement).value = ""; }
                      }
                    }}
                  />
                </div>
                <div className="flex flex-wrap gap-1">{ts.prompt_dont.map((item, i) => (
                  <Badge key={i} variant="destructive" className="cursor-pointer text-xs" onClick={() => updateTaskSet(index, { prompt_dont: ts.prompt_dont.filter((_, ii) => ii !== i) })}>🚫 {item} ×</Badge>
                ))}</div>
              </div>
            </div>

            {/* Admin rules (JSON editor) */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Regras Administrativas (JSON)</Label>
              <Textarea
                value={JSON.stringify(ts.admin_rules, null, 2)}
                onChange={e => {
                  try {
                    const parsed = JSON.parse(e.target.value);
                    updateTaskSet(index, { admin_rules: parsed });
                  } catch { /* ignore parse errors while typing */ }
                }}
                rows={4}
                className="font-mono text-xs"
              />
            </div>

            {/* Technical Validation */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold flex items-center gap-1">
                Validação Técnica <AlertTriangle className="h-3 w-3 text-destructive" />
              </Label>
              {renderValidationRules(ts.tech_validation || [], index, "tech")}
            </div>

            {/* Content Validation */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Validação de Conteúdo</Label>
              {renderValidationRules(ts.content_validation || [], index, "content")}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{campaignId ? "Editar Campanha" : "Nova Campanha"}</DialogTitle>
          <DialogDescription>Configure todos os parâmetros da campanha</DialogDescription>
        </DialogHeader>

        {loadingCampaign && campaignId ? (
          <div className="py-8 text-center text-muted-foreground">Carregando...</div>
        ) : (
          <Tabs defaultValue="general" className="flex-1 overflow-hidden flex flex-col">
            <TabsList className="grid grid-cols-3 w-full md:grid-cols-6">
              <TabsTrigger value="general">Geral</TabsTrigger>
              <TabsTrigger value="geo">Geografia</TabsTrigger>
              <TabsTrigger value="lang">Idiomas</TabsTrigger>
              <TabsTrigger value="tasks">Tarefas</TabsTrigger>
              <TabsTrigger value="reward">Reward</TabsTrigger>
              <TabsTrigger value="quality">Qualidade</TabsTrigger>
            </TabsList>

            <ScrollArea className="flex-1 mt-4 max-h-[55vh]">
              {/* GENERAL */}
              <TabsContent value="general" className="space-y-4 pr-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Nome *</Label>
                    <Input value={name} onChange={e => setName(e.target.value)} placeholder="Nome da campanha" />
                  </div>
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select value={campaignStatus} onValueChange={setCampaignStatus}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Rascunho</SelectItem>
                        <SelectItem value="active">Ativa</SelectItem>
                        <SelectItem value="paused">Pausada</SelectItem>
                        <SelectItem value="completed">Concluída</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Descrição</Label>
                  <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
                </div>

                <div className="space-y-2">
                  <Label>Cliente</Label>
                  {showNewClient ? (
                    <div className="flex gap-2">
                      <Input value={newClientName} onChange={e => setNewClientName(e.target.value)} placeholder="Nome do cliente" />
                      <Button onClick={handleCreateClient} disabled={!newClientName.trim()}>Criar</Button>
                      <Button variant="ghost" onClick={() => setShowNewClient(false)}>Cancelar</Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Select value={clientId} onValueChange={setClientId}>
                        <SelectTrigger className="flex-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          {clients?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button variant="outline" onClick={() => setShowNewClient(true)}><Plus className="h-4 w-4" /></Button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Idioma Primário</Label>
                    <Input value={languagePrimary} onChange={e => setLanguagePrimary(e.target.value)} placeholder="pt-BR" />
                  </div>
                  <div className="space-y-2">
                    <Label>Timezone</Label>
                    <Input value={timezone} onChange={e => setTimezone(e.target.value)} />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Data Início</Label>
                    <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Data Fim</Label>
                    <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Duração ({durationUnit})</Label>
                    <div className="flex gap-2">
                      <Input type="number" value={durationValue ?? ""} onChange={e => setDurationValue(e.target.value ? parseInt(e.target.value) : undefined)} />
                      <Select value={durationUnit} onValueChange={setDurationUnit}>
                        <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="days">Dias</SelectItem>
                          <SelectItem value="weeks">Semanas</SelectItem>
                          <SelectItem value="months">Meses</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Meta de Horas</Label>
                    <Input type="number" step="0.5" value={targetHours || ""} onChange={e => setTargetHours(parseFloat(e.target.value) || 0)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Partner ID</Label>
                    <Input value={partnerId} onChange={e => setPartnerId(e.target.value)} placeholder="Ex: partner_001" />
                  </div>
                </div>

                <div className="flex gap-6">
                  <div className="flex items-center gap-2">
                    <Switch checked={isActive} onCheckedChange={setIsActive} />
                    <Label>Ativa</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={visibilityIsPublic} onCheckedChange={setVisibilityIsPublic} />
                    <Label>Pública</Label>
                  </div>
                </div>
              </TabsContent>

              {/* GEOGRAPHIC SCOPE */}
              <TabsContent value="geo" className="space-y-4 pr-4">
                <div className="space-y-2">
                  <Label>Modo de Restrição</Label>
                  <Select value={geoScope.restriction_mode} onValueChange={v => setGeoScope(p => ({ ...p, restriction_mode: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="include">Incluir</SelectItem>
                      <SelectItem value="exclude">Excluir</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {renderGeoField("continents", "Continentes")}
                {renderGeoField("countries", "Países")}
                {renderGeoField("regions", "Regiões")}
                {renderGeoField("states", "Estados")}
                {renderGeoField("cities", "Cidades")}
              </TabsContent>

              {/* LANGUAGE VARIANTS */}
              <TabsContent value="lang" className="space-y-4 pr-4">
                <div className="flex justify-between items-center">
                  <Label>Variantes de Idioma</Label>
                  <Button variant="outline" size="sm" onClick={() => setLangVariants(prev => [...prev, { variant_id: "", label: "", notes: null, is_primary: prev.length === 0 }])}>
                    <Plus className="h-4 w-4 mr-1" /> Adicionar
                  </Button>
                </div>
                {langVariants.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
                    Nenhuma variante de idioma configurada.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {langVariants.map((v, i) => (
                      <div key={i} className="border rounded-lg p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">Variante {i + 1}</span>
                          <div className="flex items-center gap-1 ml-auto">
                            <Switch checked={v.is_primary} onCheckedChange={c => setLangVariants(prev => prev.map((lv, li) => ({ ...lv, is_primary: li === i ? c : false })))} />
                            <Label className="text-xs">Primária</Label>
                          </div>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setLangVariants(prev => prev.filter((_, li) => li !== i))}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Input value={v.variant_id} onChange={e => setLangVariants(prev => prev.map((lv, li) => li === i ? { ...lv, variant_id: e.target.value } : lv))} placeholder="ID (ex: pt-BR-standard)" />
                          <Input value={v.label} onChange={e => setLangVariants(prev => prev.map((lv, li) => li === i ? { ...lv, label: e.target.value } : lv))} placeholder="Label" />
                        </div>
                        <Input value={v.notes || ""} onChange={e => setLangVariants(prev => prev.map((lv, li) => li === i ? { ...lv, notes: e.target.value || null } : lv))} placeholder="Notas" />
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* TASK SETS */}
              <TabsContent value="tasks" className="space-y-4 pr-4">
                <div className="flex justify-between items-center">
                  <Label className="text-base font-semibold">Conjuntos de Tarefas ({taskSets.length})</Label>
                  <Select onValueChange={v => addTaskSet(v)}>
                    <SelectTrigger className="w-56"><SelectValue placeholder="Adicionar tipo de tarefa" /></SelectTrigger>
                    <SelectContent>
                      {catalog?.map(c => (
                        <SelectItem key={c.task_type} value={c.task_type}>{c.ui_label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {taskSets.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
                    Nenhum conjunto de tarefas. Adicione um tipo acima.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {taskSets.map((ts, i) => renderTaskSetCard(ts, i))}
                  </div>
                )}
              </TabsContent>

              {/* REWARD CONFIG */}
              <TabsContent value="reward" className="space-y-4 pr-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Moeda</Label>
                    <Select value={reward.currency} onValueChange={v => setReward(p => ({ ...p, currency: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="BRL">BRL</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Modelo de Pagamento</Label>
                    <Select value={reward.payout_model} onValueChange={v => setReward(p => ({ ...p, payout_model: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="per_accepted_unit">Por unidade aceita</SelectItem>
                        <SelectItem value="per_accepted_hour">Por hora aceita</SelectItem>
                        <SelectItem value="per_session">Por sessão</SelectItem>
                        <SelectItem value="fixed">Fixo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Taxa Base</Label>
                    <Input type="number" step="0.01" value={reward.base_rate ?? ""} onChange={e => setReward(p => ({ ...p, base_rate: e.target.value ? parseFloat(e.target.value) : null }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Taxa Bônus</Label>
                    <Input type="number" step="0.01" value={reward.bonus_rate ?? ""} onChange={e => setReward(p => ({ ...p, bonus_rate: e.target.value ? parseFloat(e.target.value) : null }))} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Condição de Bônus</Label>
                  <Input value={reward.bonus_condition || ""} onChange={e => setReward(p => ({ ...p, bonus_condition: e.target.value }))} placeholder="Ex: acceptance_rate >= 90" />
                </div>
              </TabsContent>

              {/* QUALITY FLOW */}
              <TabsContent value="quality" className="space-y-4 pr-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Modo de Revisão</Label>
                    <Select value={quality.review_mode} onValueChange={v => setQuality(p => ({ ...p, review_mode: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="automatic">Automático</SelectItem>
                        <SelectItem value="manual">Manual</SelectItem>
                        <SelectItem value="hybrid">Híbrido</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Amostragem para Revisão Manual (%)</Label>
                    <Input type="number" value={quality.sampling_rate_value ?? ""} onChange={e => setQuality(p => ({ ...p, sampling_rate_value: e.target.value ? parseFloat(e.target.value) : null }))} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Motivos de Rejeição</Label>
                  <div className="flex flex-wrap gap-1">
                    {quality.rejection_reasons.map((reason, i) => (
                      <Badge key={i} variant="outline" className="cursor-pointer" onClick={() => setQuality(p => ({ ...p, rejection_reasons: p.rejection_reasons.filter((_, ri) => ri !== i) }))}>
                        {reason} ×
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Adicionar motivo"
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const v = (e.target as HTMLInputElement).value.trim();
                          if (v) { setQuality(p => ({ ...p, rejection_reasons: [...p.rejection_reasons, v] })); (e.target as HTMLInputElement).value = ""; }
                        }
                      }}
                    />
                  </div>
                </div>
              </TabsContent>
            </ScrollArea>

            {/* Actions */}
            <div className="flex justify-between pt-4 border-t mt-4">
              {campaignId ? (
                <Button variant="destructive" onClick={handleDelete} disabled={isLoading}>Excluir</Button>
              ) : <div />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>Cancelar</Button>
                <Button onClick={handleSave} disabled={isLoading}>
                  {isLoading ? "Salvando..." : campaignId ? "Atualizar" : "Criar"}
                </Button>
              </div>
            </div>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
