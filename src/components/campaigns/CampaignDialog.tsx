import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, AlertTriangle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCampaign,
  useClients,
  useCreateCampaign,
  useUpdateCampaign,
  useDeleteCampaign,
  useCreateClient,
} from "@/hooks/useCampaigns";
import type {
  GeographicScope,
  LanguageVariant,
  TaskConfig,
  AdministrativeRules,
  AudioValidationRule,
  ContentValidationRule,
  RewardConfig,
  QualityFlow,
} from "@/lib/campaignTypes";
import {
  DEFAULT_AUDIO_RULES,
  DEFAULT_CONTENT_RULES,
  RULE_LABELS,
} from "@/lib/campaignTypes";
import { toast } from "@/hooks/use-toast";

interface CampaignDialogProps {
  open: boolean;
  onClose: () => void;
  campaignId: string | null;
}

export function CampaignDialog({ open, onClose, campaignId }: CampaignDialogProps) {
  const { data: campaign, isLoading: loadingCampaign } = useCampaign(campaignId ?? undefined);
  const { data: clients } = useClients();
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
  const [campaignType, setCampaignType] = useState("audio_capture_group");
  const [campaignStatus, setCampaignStatus] = useState("draft");
  const [durationUnit, setDurationUnit] = useState("days");
  const [durationValue, setDurationValue] = useState<number | undefined>();
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [visibilityIsPublic, setVisibilityIsPublic] = useState(false);
  const [partnerId, setPartnerId] = useState("");

  // Geographic scope
  const [geoScope, setGeoScope] = useState<GeographicScope>({
    restriction_mode: "include",
    continents: [],
    countries: [],
    regions: [],
    states: [],
    cities: [],
  });

  // Language variants
  const [langVariants, setLangVariants] = useState<LanguageVariant[]>([]);

  // Task config
  const [taskConfig, setTaskConfig] = useState<TaskConfig>({
    task_type: "audio_capture_group",
    instructions_title: "",
    instructions_summary: "",
    prompt_topic: "",
    prompt_do: [],
    prompt_dont: [],
  });

  // Administrative rules
  const [adminRules, setAdminRules] = useState<AdministrativeRules>({
    max_hours_per_user: null,
    max_hours_per_partner_per_user: null,
    min_acceptance_rate: null,
    min_acceptance_rate_unit: "percent",
    max_sessions_per_user: null,
    min_participants_per_session: null,
    max_participants_per_session: null,
  });

  // Audio & content validation
  const [audioRules, setAudioRules] = useState<AudioValidationRule[]>(DEFAULT_AUDIO_RULES);
  const [contentRules, setContentRules] = useState<ContentValidationRule[]>(DEFAULT_CONTENT_RULES);

  // Reward
  const [reward, setReward] = useState<RewardConfig>({
    currency: "USD",
    payout_model: "per_accepted_hour",
    base_rate: null,
    bonus_rate: null,
    bonus_condition: "",
  });

  // Quality flow
  const [quality, setQuality] = useState<QualityFlow>({
    review_mode: "hybrid",
    sampling_rate_value: 10,
    sampling_rate_unit: "percent",
    rejection_reasons: ["low_snr", "rms_out_of_range", "metadata_missing", "prompt_non_compliance", "topic_not_covered"],
  });

  // New client
  const [newClientName, setNewClientName] = useState("");
  const [showNewClient, setShowNewClient] = useState(false);

  // Temp inputs for array fields
  const [tempDo, setTempDo] = useState("");
  const [tempDont, setTempDont] = useState("");
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
      setCampaignType(campaign.campaign_type || "audio_capture_group");
      setCampaignStatus(campaign.campaign_status || "draft");
      setDurationUnit(campaign.duration_unit || "days");
      setDurationValue(campaign.duration_value ?? undefined);
      setTimezone(campaign.timezone || "America/Sao_Paulo");
      setVisibilityIsPublic(campaign.visibility_is_public ?? false);
      setPartnerId(campaign.partner_id || "");

      if (campaign.geographic_scope) setGeoScope(campaign.geographic_scope);
      if (campaign.language_variants?.length) setLangVariants(campaign.language_variants);
      if (campaign.task_config) setTaskConfig(campaign.task_config);
      if (campaign.administrative_rules) setAdminRules(campaign.administrative_rules);
      if (campaign.audio_validation?.length) setAudioRules(campaign.audio_validation);
      if (campaign.content_validation?.length) setContentRules(campaign.content_validation);
      if (campaign.reward_config) setReward(campaign.reward_config);
      if (campaign.quality_flow) setQuality(campaign.quality_flow);
    } else if (!campaignId) {
      // Reset defaults
      setName(""); setDescription(""); setClientId(""); setStartDate(""); setEndDate("");
      setTargetHours(0); setIsActive(true); setCampaignType("audio_capture_group");
      setCampaignStatus("draft"); setDurationUnit("days"); setDurationValue(undefined);
      setTimezone("America/Sao_Paulo"); setVisibilityIsPublic(false); setPartnerId("");
      setGeoScope({ restriction_mode: "include", continents: [], countries: [], regions: [], states: [], cities: [] });
      setLangVariants([]);
      setTaskConfig({ task_type: "audio_capture_group", instructions_title: "", instructions_summary: "", prompt_topic: "", prompt_do: [], prompt_dont: [] });
      setAdminRules({ max_hours_per_user: null, max_hours_per_partner_per_user: null, min_acceptance_rate: null, min_acceptance_rate_unit: "percent", max_sessions_per_user: null, min_participants_per_session: null, max_participants_per_session: null });
      setAudioRules(DEFAULT_AUDIO_RULES);
      setContentRules(DEFAULT_CONTENT_RULES);
      setReward({ currency: "USD", payout_model: "per_accepted_hour", base_rate: null, bonus_rate: null, bonus_condition: "" });
      setQuality({ review_mode: "hybrid", sampling_rate_value: 10, sampling_rate_unit: "percent", rejection_reasons: ["low_snr", "rms_out_of_range", "metadata_missing", "prompt_non_compliance", "topic_not_covered"] });
    }
  }, [campaign, campaignId]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: "Nome obrigatório", variant: "destructive" });
      return;
    }
    try {
      const payload = {
        campaign: {
          name, description: description || null, client_id: clientId || null,
          start_date: startDate || null, end_date: endDate || null,
          target_hours: targetHours || null, is_active: isActive,
          campaign_type: campaignType, campaign_status: campaignStatus,
          duration_unit: durationUnit, duration_value: durationValue ?? null,
          timezone, visibility_is_public: visibilityIsPublic,
          partner_id: partnerId || null,
        },
        geographic_scope: geoScope,
        language_variants: langVariants,
        task_config: taskConfig,
        administrative_rules: adminRules,
        audio_validation: audioRules,
        content_validation: contentRules,
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
    setGeoScope(prev => ({
      ...prev,
      [field]: [...(prev[field] as string[]), value.trim()],
    }));
    setTempGeoField(prev => ({ ...prev, [field]: "" }));
  };

  const removeGeoItem = (field: keyof GeographicScope, index: number) => {
    setGeoScope(prev => ({
      ...prev,
      [field]: (prev[field] as string[]).filter((_, i) => i !== index),
    }));
  };

  const isLoading = createCampaign.isPending || updateCampaign.isPending || deleteCampaign.isPending;

  const updateAudioRule = (index: number, field: keyof AudioValidationRule, value: any) => {
    setAudioRules(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  };

  const updateContentRule = (index: number, field: keyof ContentValidationRule, value: any) => {
    setContentRules(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  };

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
            <TabsList className="grid grid-cols-4 w-full md:grid-cols-8">
              <TabsTrigger value="general">Geral</TabsTrigger>
              <TabsTrigger value="geo">Geografia</TabsTrigger>
              <TabsTrigger value="lang">Idiomas</TabsTrigger>
              <TabsTrigger value="task">Tarefa</TabsTrigger>
              <TabsTrigger value="audio">Áudio</TabsTrigger>
              <TabsTrigger value="content">Conteúdo</TabsTrigger>
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
                    <Label>Tipo</Label>
                    <Select value={campaignType} onValueChange={setCampaignType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="audio_capture_group">Captura em Grupo</SelectItem>
                        <SelectItem value="audio_capture_solo">Captura Solo</SelectItem>
                        <SelectItem value="transcription">Transcrição</SelectItem>
                      </SelectContent>
                    </Select>
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

              {/* TASK CONFIG */}
              <TabsContent value="task" className="space-y-4 pr-4">
                <div className="space-y-2">
                  <Label>Tipo de Tarefa</Label>
                  <Select value={taskConfig.task_type} onValueChange={v => setTaskConfig(p => ({ ...p, task_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="audio_capture_group">Captura em Grupo</SelectItem>
                      <SelectItem value="audio_capture_solo">Captura Solo</SelectItem>
                      <SelectItem value="transcription">Transcrição</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Título das Instruções</Label>
                  <Input value={taskConfig.instructions_title || ""} onChange={e => setTaskConfig(p => ({ ...p, instructions_title: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Resumo</Label>
                  <Textarea value={taskConfig.instructions_summary || ""} onChange={e => setTaskConfig(p => ({ ...p, instructions_summary: e.target.value }))} rows={2} />
                </div>
                <div className="space-y-2">
                  <Label>Tópico do Prompt</Label>
                  <Input value={taskConfig.prompt_topic || ""} onChange={e => setTaskConfig(p => ({ ...p, prompt_topic: e.target.value }))} />
                </div>
                {/* DO */}
                <div className="space-y-2">
                  <Label>O que FAZER</Label>
                  <div className="flex gap-2">
                    <Input value={tempDo} onChange={e => setTempDo(e.target.value)} placeholder="Adicionar instrução" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (tempDo.trim()) { setTaskConfig(p => ({ ...p, prompt_do: [...p.prompt_do, tempDo.trim()] })); setTempDo(""); } } }} />
                    <Button variant="outline" size="icon" onClick={() => { if (tempDo.trim()) { setTaskConfig(p => ({ ...p, prompt_do: [...p.prompt_do, tempDo.trim()] })); setTempDo(""); } }}><Plus className="h-4 w-4" /></Button>
                  </div>
                  {taskConfig.prompt_do.map((item, i) => (
                    <Badge key={i} variant="secondary" className="cursor-pointer mr-1" onClick={() => setTaskConfig(p => ({ ...p, prompt_do: p.prompt_do.filter((_, ii) => ii !== i) }))}>
                      ✅ {item} ×
                    </Badge>
                  ))}
                </div>
                {/* DONT */}
                <div className="space-y-2">
                  <Label>O que NÃO fazer</Label>
                  <div className="flex gap-2">
                    <Input value={tempDont} onChange={e => setTempDont(e.target.value)} placeholder="Adicionar restrição" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (tempDont.trim()) { setTaskConfig(p => ({ ...p, prompt_dont: [...p.prompt_dont, tempDont.trim()] })); setTempDont(""); } } }} />
                    <Button variant="outline" size="icon" onClick={() => { if (tempDont.trim()) { setTaskConfig(p => ({ ...p, prompt_dont: [...p.prompt_dont, tempDont.trim()] })); setTempDont(""); } }}><Plus className="h-4 w-4" /></Button>
                  </div>
                  {taskConfig.prompt_dont.map((item, i) => (
                    <Badge key={i} variant="destructive" className="cursor-pointer mr-1" onClick={() => setTaskConfig(p => ({ ...p, prompt_dont: p.prompt_dont.filter((_, ii) => ii !== i) }))}>
                      🚫 {item} ×
                    </Badge>
                  ))}
                </div>

                {/* Admin rules */}
                <div className="border-t pt-4 mt-4">
                  <Label className="text-base font-semibold">Regras Administrativas</Label>
                  <div className="grid grid-cols-2 gap-4 mt-3">
                    <div className="space-y-2">
                      <Label className="text-xs">Max horas/usuário</Label>
                      <Input type="number" value={adminRules.max_hours_per_user ?? ""} onChange={e => setAdminRules(p => ({ ...p, max_hours_per_user: e.target.value ? parseFloat(e.target.value) : null }))} />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Max horas/partner/usuário</Label>
                      <Input type="number" value={adminRules.max_hours_per_partner_per_user ?? ""} onChange={e => setAdminRules(p => ({ ...p, max_hours_per_partner_per_user: e.target.value ? parseFloat(e.target.value) : null }))} />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Taxa aceitação mín. (%)</Label>
                      <Input type="number" value={adminRules.min_acceptance_rate ?? ""} onChange={e => setAdminRules(p => ({ ...p, min_acceptance_rate: e.target.value ? parseFloat(e.target.value) : null }))} />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Max sessões/usuário</Label>
                      <Input type="number" value={adminRules.max_sessions_per_user ?? ""} onChange={e => setAdminRules(p => ({ ...p, max_sessions_per_user: e.target.value ? parseInt(e.target.value) : null }))} />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Mín. participantes/sessão</Label>
                      <Input type="number" value={adminRules.min_participants_per_session ?? ""} onChange={e => setAdminRules(p => ({ ...p, min_participants_per_session: e.target.value ? parseInt(e.target.value) : null }))} />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Máx. participantes/sessão</Label>
                      <Input type="number" value={adminRules.max_participants_per_session ?? ""} onChange={e => setAdminRules(p => ({ ...p, max_participants_per_session: e.target.value ? parseInt(e.target.value) : null }))} />
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* AUDIO VALIDATION */}
              <TabsContent value="audio" className="space-y-3 pr-4">
                <Label className="text-base font-semibold">Regras de Validação de Áudio</Label>
                <div className="space-y-2">
                  {audioRules.map((rule, i) => (
                    <div key={rule.rule_key} className="grid grid-cols-[1fr_80px_80px_80px_60px] gap-2 items-center text-sm">
                      <span className="truncate">{RULE_LABELS[rule.rule_key] || rule.rule_key}</span>
                      <Input type="number" step="any" value={rule.min_value ?? ""} onChange={e => updateAudioRule(i, "min_value", e.target.value ? parseFloat(e.target.value) : null)} placeholder="Mín" className="h-8 text-xs" />
                      <Input type="number" step="any" value={rule.max_value ?? ""} onChange={e => updateAudioRule(i, "max_value", e.target.value ? parseFloat(e.target.value) : null)} placeholder="Máx" className="h-8 text-xs" />
                      <Input type="number" step="any" value={rule.target_value ?? ""} onChange={e => updateAudioRule(i, "target_value", e.target.value ? parseFloat(e.target.value) : null)} placeholder="Alvo" className="h-8 text-xs" />
                      <div className="flex items-center justify-center">
                        <Switch checked={rule.is_critical} onCheckedChange={c => updateAudioRule(i, "is_critical", c)} />
                        {rule.is_critical && <AlertTriangle className="h-3 w-3 text-destructive ml-1" />}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> = regra crítica (rejeição automática)
                </p>
              </TabsContent>

              {/* CONTENT VALIDATION */}
              <TabsContent value="content" className="space-y-3 pr-4">
                <Label className="text-base font-semibold">Regras de Validação de Conteúdo</Label>
                <div className="space-y-2">
                  {contentRules.map((rule, i) => (
                    <div key={rule.rule_key} className="grid grid-cols-[1fr_80px_80px_60px] gap-2 items-center text-sm">
                      <span className="truncate">{RULE_LABELS[rule.rule_key] || rule.rule_key}</span>
                      <Input type="number" step="any" value={rule.min_value ?? ""} onChange={e => updateContentRule(i, "min_value", e.target.value ? parseFloat(e.target.value) : null)} placeholder="Mín" className="h-8 text-xs" />
                      <Input type="number" step="any" value={rule.max_value ?? ""} onChange={e => updateContentRule(i, "max_value", e.target.value ? parseFloat(e.target.value) : null)} placeholder="Máx" className="h-8 text-xs" />
                      <div className="flex items-center justify-center">
                        <Switch checked={rule.is_critical} onCheckedChange={c => updateContentRule(i, "is_critical", c)} />
                      </div>
                    </div>
                  ))}
                </div>
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
                          const val = (e.target as HTMLInputElement).value.trim();
                          if (val) {
                            setQuality(p => ({ ...p, rejection_reasons: [...p.rejection_reasons, val] }));
                            (e.target as HTMLInputElement).value = "";
                          }
                        }
                      }}
                    />
                  </div>
                </div>
              </TabsContent>
            </ScrollArea>

            <div className="flex justify-between pt-4 border-t mt-4">
              {campaignId && (
                <Button variant="destructive" onClick={handleDelete} disabled={isLoading}>
                  <Trash2 className="h-4 w-4 mr-2" /> Excluir
                </Button>
              )}
              <div className="flex gap-2 ml-auto">
                <Button variant="outline" onClick={onClose} disabled={isLoading}>Cancelar</Button>
                <Button onClick={handleSave} disabled={isLoading}>
                  {isLoading ? "Salvando..." : campaignId ? "Salvar" : "Criar"}
                </Button>
              </div>
            </div>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
