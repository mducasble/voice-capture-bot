import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import {
  Database, Plus, Pencil, Archive, ChevronRight, Layers,
  FileAudio, FileVideo, FileText, Image, GripVertical,
  Trash2, Loader2, Tag, BookOpen,
} from "lucide-react";

const CONTENT_TYPES = [
  { key: "audio", label: "Áudio", icon: FileAudio },
  { key: "video", label: "Vídeo", icon: FileVideo },
  { key: "text", label: "Texto/Anotação", icon: FileText },
  { key: "image", label: "Imagem", icon: Image },
] as const;

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  draft: { label: "Rascunho", className: "bg-muted text-muted-foreground" },
  active: { label: "Ativo", className: "bg-emerald-500/20 text-emerald-400" },
  archived: { label: "Arquivado", className: "bg-yellow-500/20 text-yellow-400" },
};

type DatasetForm = {
  name: string;
  slug: string;
  status: string;
  content_types: string[];
  objective: string;
  primary_task: string;
  data_origin: string;
  population_coverage: string;
  collection_process: string;
  exclusion_criteria: string;
  annotation_process: string;
  quality_metrics: string;
  known_limitations: string;
  risks: string;
  recommended_uses: string;
  not_recommended_uses: string;
  license_restrictions: string;
  tags: string[];
};

type PipelineStageForm = {
  id?: string;
  stage_key: string;
  label: string;
  sort_order: number;
  stage_type: string;
  description: string;
  automation_config: string; // JSON string
};

const emptyForm: DatasetForm = {
  name: "", slug: "", status: "draft", content_types: [],
  objective: "", primary_task: "", data_origin: "", population_coverage: "",
  collection_process: "", exclusion_criteria: "", annotation_process: "",
  quality_metrics: "", known_limitations: "", risks: "",
  recommended_uses: "", not_recommended_uses: "", license_restrictions: "",
  tags: [],
};

export default function AdminDatasets() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DatasetForm>({ ...emptyForm });
  const [stages, setStages] = useState<PipelineStageForm[]>([]);
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [dialogTab, setDialogTab] = useState("datacard");

  const { data: datasets, isLoading } = useQuery({
    queryKey: ["datasets-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("datasets")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: campaigns } = useQuery({
    queryKey: ["campaigns-simple"],
    queryFn: async () => {
      const { data } = await supabase.from("campaigns").select("id, name").order("name");
      return data ?? [];
    },
  });

  const [linkedCampaigns, setLinkedCampaigns] = useState<string[]>([]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setStages([]);
    setLinkedCampaigns([]);
    setDialogTab("datacard");
    setDialogOpen(true);
  };

  const openEdit = async (dataset: any) => {
    setEditingId(dataset.id);
    setForm({
      name: dataset.name || "",
      slug: dataset.slug || "",
      status: dataset.status || "draft",
      content_types: dataset.content_types || [],
      objective: dataset.objective || "",
      primary_task: dataset.primary_task || "",
      data_origin: dataset.data_origin || "",
      population_coverage: dataset.population_coverage || "",
      collection_process: dataset.collection_process || "",
      exclusion_criteria: dataset.exclusion_criteria || "",
      annotation_process: dataset.annotation_process || "",
      quality_metrics: dataset.quality_metrics || "",
      known_limitations: dataset.known_limitations || "",
      risks: dataset.risks || "",
      recommended_uses: dataset.recommended_uses || "",
      not_recommended_uses: dataset.not_recommended_uses || "",
      license_restrictions: dataset.license_restrictions || "",
      tags: dataset.tags || [],
    });

    // Load stages
    const { data: stagesData } = await supabase
      .from("dataset_pipeline_stages")
      .select("*")
      .eq("dataset_id", dataset.id)
      .order("sort_order");

    setStages((stagesData ?? []).map((s: any) => ({
      id: s.id,
      stage_key: s.stage_key,
      label: s.label,
      sort_order: s.sort_order,
      stage_type: s.stage_type,
      description: s.description || "",
      automation_config: s.automation_config ? JSON.stringify(s.automation_config) : "",
    })));

    // Load linked campaigns
    const { data: links } = await supabase
      .from("dataset_campaigns")
      .select("campaign_id")
      .eq("dataset_id", dataset.id);
    setLinkedCampaigns((links ?? []).map((l: any) => l.campaign_id));

    setDialogTab("datacard");
    setDialogOpen(true);
  };

  const updateField = (field: keyof DatasetForm, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const toggleContentType = (type: string) => {
    setForm(prev => ({
      ...prev,
      content_types: prev.content_types.includes(type)
        ? prev.content_types.filter(t => t !== type)
        : [...prev.content_types, type],
    }));
  };

  const addTag = () => {
    const tag = tagInput.trim();
    if (tag && !form.tags.includes(tag)) {
      updateField("tags", [...form.tags, tag]);
    }
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    updateField("tags", form.tags.filter(t => t !== tag));
  };

  // Pipeline stages management
  const addStage = () => {
    const order = stages.length;
    setStages(prev => [...prev, {
      stage_key: `stage_${order + 1}`,
      label: "",
      sort_order: order,
      stage_type: "manual",
      description: "",
      automation_config: "",
    }]);
  };

  const updateStage = (idx: number, field: keyof PipelineStageForm, value: any) => {
    setStages(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const removeStage = (idx: number) => {
    setStages(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, sort_order: i })));
  };

  const moveStage = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= stages.length) return;
    setStages(prev => {
      const arr = [...prev];
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr.map((s, i) => ({ ...s, sort_order: i }));
    });
  };

  const toggleLinkedCampaign = (id: string) => {
    setLinkedCampaigns(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Nome é obrigatório"); return; }
    setSaving(true);
    try {
      const slug = form.slug || form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const payload = {
        name: form.name,
        slug,
        status: form.status,
        content_types: form.content_types,
        objective: form.objective || null,
        primary_task: form.primary_task || null,
        data_origin: form.data_origin || null,
        population_coverage: form.population_coverage || null,
        collection_process: form.collection_process || null,
        exclusion_criteria: form.exclusion_criteria || null,
        annotation_process: form.annotation_process || null,
        quality_metrics: form.quality_metrics || null,
        known_limitations: form.known_limitations || null,
        risks: form.risks || null,
        recommended_uses: form.recommended_uses || null,
        not_recommended_uses: form.not_recommended_uses || null,
        license_restrictions: form.license_restrictions || null,
        tags: form.tags,
      };

      let datasetId = editingId;

      if (editingId) {
        const { error } = await supabase.from("datasets").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("datasets").insert(payload).select("id").single();
        if (error) throw error;
        datasetId = data.id;
      }

      // Save pipeline stages
      if (datasetId) {
        // Delete existing stages that were removed
        const existingStageIds = stages.filter(s => s.id).map(s => s.id!);
        if (editingId) {
          await supabase
            .from("dataset_pipeline_stages")
            .delete()
            .eq("dataset_id", datasetId)
            .not("id", "in", `(${existingStageIds.join(",")})`);
        }

        for (const stage of stages) {
          const stagePayload = {
            dataset_id: datasetId,
            stage_key: stage.stage_key,
            label: stage.label,
            sort_order: stage.sort_order,
            stage_type: stage.stage_type,
            description: stage.description || null,
            automation_config: stage.automation_config ? JSON.parse(stage.automation_config) : null,
          };

          if (stage.id) {
            await supabase.from("dataset_pipeline_stages").update(stagePayload).eq("id", stage.id);
          } else {
            await supabase.from("dataset_pipeline_stages").insert(stagePayload);
          }
        }

        // Save campaign links
        await supabase.from("dataset_campaigns").delete().eq("dataset_id", datasetId);
        if (linkedCampaigns.length > 0) {
          await supabase.from("dataset_campaigns").insert(
            linkedCampaigns.map(cid => ({ dataset_id: datasetId!, campaign_id: cid }))
          );
        }
      }

      toast.success(editingId ? "Dataset atualizado" : "Dataset criado");
      setDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["datasets-list"] });
    } catch (err) {
      toast.error("Erro: " + (err as Error).message);
    }
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Database className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Datasets</h1>
          <Badge variant="outline">{datasets?.length ?? 0}</Badge>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> Novo Dataset
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !datasets?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Database className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">Nenhum dataset criado ainda</p>
            <Button onClick={openCreate} variant="outline" className="mt-4 gap-2">
              <Plus className="h-4 w-4" /> Criar primeiro dataset
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {datasets.map((ds: any) => (
            <Card
              key={ds.id}
              className="cursor-pointer hover:border-primary/30 transition-colors"
              onClick={() => openEdit(ds)}
            >
              <CardContent className="pt-5 pb-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold truncate">{ds.name}</h3>
                    {ds.slug && <p className="text-xs text-muted-foreground font-mono">{ds.slug}</p>}
                  </div>
                  <Badge className={STATUS_MAP[ds.status]?.className || ""} variant="outline">
                    {STATUS_MAP[ds.status]?.label || ds.status}
                  </Badge>
                </div>

                {ds.objective && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{ds.objective}</p>
                )}

                <div className="flex flex-wrap gap-1.5">
                  {(ds.content_types || []).map((ct: string) => {
                    const info = CONTENT_TYPES.find(c => c.key === ct);
                    return info ? (
                      <Badge key={ct} variant="secondary" className="text-[10px] gap-1">
                        <info.icon className="h-3 w-3" /> {info.label}
                      </Badge>
                    ) : null;
                  })}
                </div>

                {ds.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {ds.tags.slice(0, 4).map((t: string) => (
                      <span key={t} className="text-[10px] bg-muted/50 text-muted-foreground px-1.5 py-0.5 rounded">{t}</span>
                    ))}
                    {ds.tags.length > 4 && <span className="text-[10px] text-muted-foreground">+{ds.tags.length - 4}</span>}
                  </div>
                )}

                <div className="text-[10px] text-muted-foreground pt-1 border-t border-border/30">
                  Criado em {new Date(ds.created_at).toLocaleDateString("pt-BR")}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              {editingId ? "Editar Dataset" : "Novo Dataset"}
            </DialogTitle>
          </DialogHeader>

          <Tabs value={dialogTab} onValueChange={setDialogTab}>
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="datacard">Datacard</TabsTrigger>
              <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
              <TabsTrigger value="campaigns">Campanhas</TabsTrigger>
              <TabsTrigger value="metadata">Metadata</TabsTrigger>
            </TabsList>

            {/* ===== DATACARD TAB ===== */}
            <TabsContent value="datacard" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Nome *</Label>
                  <Input value={form.name} onChange={e => updateField("name", e.target.value)} placeholder="Ex: Brazilian Portuguese Conversations v1" />
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={v => updateField("status", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Rascunho</SelectItem>
                      <SelectItem value="active">Ativo</SelectItem>
                      <SelectItem value="archived">Arquivado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Tipos de conteúdo</Label>
                <div className="flex flex-wrap gap-2">
                  {CONTENT_TYPES.map(ct => (
                    <button
                      key={ct.key}
                      type="button"
                      onClick={() => toggleContentType(ct.key)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                        form.content_types.includes(ct.key)
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-border/80"
                      }`}
                    >
                      <ct.icon className="h-3.5 w-3.5" />
                      {ct.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Objetivo</Label>
                <Textarea value={form.objective} onChange={e => updateField("objective", e.target.value)} placeholder="Qual o propósito deste dataset?" rows={2} />
              </div>

              <div className="space-y-1.5">
                <Label>Tarefa principal</Label>
                <Input value={form.primary_task} onChange={e => updateField("primary_task", e.target.value)} placeholder="Ex: ASR, TTS, Speaker Diarization, Sentiment Analysis..." />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Origem dos dados</Label>
                  <Textarea value={form.data_origin} onChange={e => updateField("data_origin", e.target.value)} placeholder="De onde vêm os dados?" rows={2} />
                </div>
                <div className="space-y-1.5">
                  <Label>População / Cobertura</Label>
                  <Textarea value={form.population_coverage} onChange={e => updateField("population_coverage", e.target.value)} placeholder="Quem são os participantes? Que regiões/idiomas cobrem?" rows={2} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Processo de coleta</Label>
                <Textarea value={form.collection_process} onChange={e => updateField("collection_process", e.target.value)} placeholder="Como os dados são coletados?" rows={2} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Critérios de exclusão</Label>
                  <Textarea value={form.exclusion_criteria} onChange={e => updateField("exclusion_criteria", e.target.value)} placeholder="O que desqualifica um dado?" rows={2} />
                </div>
                <div className="space-y-1.5">
                  <Label>Processo de anotação</Label>
                  <Textarea value={form.annotation_process} onChange={e => updateField("annotation_process", e.target.value)} placeholder="Como os dados são anotados/rotulados?" rows={2} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Métricas de qualidade</Label>
                <Textarea value={form.quality_metrics} onChange={e => updateField("quality_metrics", e.target.value)} placeholder="Quais métricas definem a qualidade? (SNR, WER, etc.)" rows={2} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Limitações conhecidas</Label>
                  <Textarea value={form.known_limitations} onChange={e => updateField("known_limitations", e.target.value)} rows={2} />
                </div>
                <div className="space-y-1.5">
                  <Label>Riscos</Label>
                  <Textarea value={form.risks} onChange={e => updateField("risks", e.target.value)} rows={2} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Usos recomendados</Label>
                  <Textarea value={form.recommended_uses} onChange={e => updateField("recommended_uses", e.target.value)} rows={2} />
                </div>
                <div className="space-y-1.5">
                  <Label>Usos NÃO recomendados</Label>
                  <Textarea value={form.not_recommended_uses} onChange={e => updateField("not_recommended_uses", e.target.value)} rows={2} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Licença e restrições</Label>
                <Textarea value={form.license_restrictions} onChange={e => updateField("license_restrictions", e.target.value)} placeholder="Ex: CC-BY-4.0, uso comercial permitido..." rows={2} />
              </div>
            </TabsContent>

            {/* ===== PIPELINE TAB ===== */}
            <TabsContent value="pipeline" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Defina as etapas do pipeline de processamento. Os items passarão por cada etapa na ordem.
                </p>
                <Button onClick={addStage} size="sm" variant="outline" className="gap-1">
                  <Plus className="h-3.5 w-3.5" /> Etapa
                </Button>
              </div>

              {stages.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <Layers className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  Nenhuma etapa definida. Clique em "+ Etapa" para começar.
                </div>
              ) : (
                <div className="space-y-3">
                  {stages.map((stage, idx) => (
                    <div key={idx} className="border border-border/50 rounded-lg p-3 space-y-2 bg-card">
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col gap-0.5">
                          <button
                            type="button"
                            onClick={() => moveStage(idx, -1)}
                            disabled={idx === 0}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-20 text-xs"
                          >▲</button>
                          <button
                            type="button"
                            onClick={() => moveStage(idx, 1)}
                            disabled={idx === stages.length - 1}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-20 text-xs"
                          >▼</button>
                        </div>
                        <span className="text-xs font-mono text-muted-foreground w-6">{idx + 1}.</span>
                        <Input
                          value={stage.label}
                          onChange={e => updateStage(idx, "label", e.target.value)}
                          placeholder="Nome da etapa"
                          className="flex-1 h-8 text-sm"
                        />
                        <Select value={stage.stage_type} onValueChange={v => updateStage(idx, "stage_type", v)}>
                          <SelectTrigger className="w-[130px] h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="manual">Manual</SelectItem>
                            <SelectItem value="automated">Automatizado</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost" size="icon"
                          onClick={() => removeStage(idx)}
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pl-8">
                        <Input
                          value={stage.stage_key}
                          onChange={e => updateStage(idx, "stage_key", e.target.value)}
                          placeholder="stage_key (ex: quality_check)"
                          className="h-7 text-xs font-mono"
                        />
                        <Input
                          value={stage.description}
                          onChange={e => updateStage(idx, "description", e.target.value)}
                          placeholder="Descrição breve"
                          className="h-7 text-xs"
                        />
                      </div>
                      {stage.stage_type === "automated" && (
                        <div className="pl-8">
                          <Input
                            value={stage.automation_config}
                            onChange={e => updateStage(idx, "automation_config", e.target.value)}
                            placeholder='{"action": "analyze-content"}'
                            className="h-7 text-xs font-mono"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ===== CAMPAIGNS TAB ===== */}
            <TabsContent value="campaigns" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                Vincule campanhas que alimentam este dataset. Uma campanha pode alimentar vários datasets.
              </p>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {campaigns?.map((c: any) => (
                  <div
                    key={c.id}
                    className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors ${
                      linkedCampaigns.includes(c.id) ? "border-primary/40 bg-primary/5" : "border-border/50 hover:border-border"
                    }`}
                    onClick={() => toggleLinkedCampaign(c.id)}
                  >
                    <Checkbox checked={linkedCampaigns.includes(c.id)} />
                    <span className="text-sm">{c.name}</span>
                  </div>
                ))}
                {!campaigns?.length && (
                  <p className="text-muted-foreground text-sm text-center py-4">Nenhuma campanha disponível</p>
                )}
              </div>
            </TabsContent>

            {/* ===== METADATA TAB ===== */}
            <TabsContent value="metadata" className="space-y-4 mt-4">
              <div className="space-y-1.5">
                <Label>Slug</Label>
                <Input
                  value={form.slug}
                  onChange={e => updateField("slug", e.target.value)}
                  placeholder="auto-gerado a partir do nome"
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Tags</Label>
                <div className="flex gap-2">
                  <Input
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    placeholder="Adicionar tag..."
                    onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addTag())}
                    className="flex-1"
                  />
                  <Button type="button" onClick={addTag} size="sm" variant="outline">
                    <Tag className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {form.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {form.tags.map(tag => (
                      <Badge key={tag} variant="secondary" className="gap-1 text-xs cursor-pointer hover:bg-destructive/20" onClick={() => removeTag(tag)}>
                        {tag} ×
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex justify-end gap-2 pt-4 border-t border-border/50">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
              {editingId ? "Salvar" : "Criar Dataset"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}