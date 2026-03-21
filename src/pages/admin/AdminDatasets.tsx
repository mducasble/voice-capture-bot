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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Database, Plus, Pencil, ChevronRight, Layers,
  FileAudio, FileVideo, FileText, Image, Trash2, Loader2,
  Tag, BookOpen, Shield, Eye, Beaker, Settings2,
} from "lucide-react";
import {
  DATASET_STATUSES, MODALITIES, TASK_FAMILIES, TASK_TYPES,
  SOURCE_TYPES, CONSENT_STATUSES, LEGAL_REVIEW_STATUSES,
  ANNOTATION_STATUSES, QC_STATUSES, SPLITS, POLICY_PROFILES,
  VIDEO_PROFILE_DIMENSIONS, AUDIO_PROFILE_DIMENSIONS,
  IMAGE_PROFILE_DIMENSIONS, TEXT_PROFILE_DIMENSIONS,
  DATASET_STATUS_STYLE, humanize,
} from "@/lib/datasetTaxonomy";

const MODALITY_ICONS: Record<string, any> = {
  audio: FileAudio, video: FileVideo, text: FileText, image: Image,
  multimodal: Layers, mixed: Layers,
};

type DatasetForm = {
  name: string;
  slug: string;
  status: string;
  modalities: string[];
  task_family: string;
  task_type: string;
  source_type: string;
  consent_status: string;
  legal_review_status: string;
  annotation_status: string;
  qc_status: string;
  policy_profile: string;
  splits: string[];
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
  video_profile: Record<string, string[]>;
  audio_profile: Record<string, string[]>;
  image_profile: Record<string, string[]>;
  text_profile: Record<string, string[]>;
};

type PipelineStageForm = {
  id?: string;
  stage_key: string;
  label: string;
  sort_order: number;
  stage_type: string;
  description: string;
  automation_config: string;
};

const emptyForm: DatasetForm = {
  name: "", slug: "", status: "draft", modalities: [],
  task_family: "", task_type: "", source_type: "",
  consent_status: "pending_review", legal_review_status: "pending",
  annotation_status: "none", qc_status: "pending", policy_profile: "",
  splits: [],
  objective: "", primary_task: "", data_origin: "", population_coverage: "",
  collection_process: "", exclusion_criteria: "", annotation_process: "",
  quality_metrics: "", known_limitations: "", risks: "",
  recommended_uses: "", not_recommended_uses: "", license_restrictions: "",
  tags: [],
  video_profile: {}, audio_profile: {}, image_profile: {}, text_profile: {},
};

// ── Multi-select pill component ─────────────────────────────────────
function PillSelect({
  options, selected, onToggle, columns = 4,
}: {
  options: readonly string[];
  selected: string[];
  onToggle: (v: string) => void;
  columns?: number;
}) {
  return (
    <div className={`grid gap-1.5`} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => onToggle(opt)}
          className={`px-2 py-1 rounded-md border text-[11px] text-left truncate transition-colors ${
            selected.includes(opt)
              ? "border-primary bg-primary/10 text-primary font-medium"
              : "border-border/50 text-muted-foreground hover:border-border"
          }`}
        >
          {humanize(opt)}
        </button>
      ))}
    </div>
  );
}

// ── Profile dimension editor ────────────────────────────────────────
function ProfileEditor({
  dimensions, profile, onChange,
}: {
  dimensions: Record<string, string[]>;
  profile: Record<string, string[]>;
  onChange: (p: Record<string, string[]>) => void;
}) {
  const toggleVal = (dim: string, val: string) => {
    const cur = profile[dim] || [];
    const next = cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val];
    onChange({ ...profile, [dim]: next });
  };

  return (
    <div className="space-y-3">
      {Object.entries(dimensions).map(([dim, vals]) => (
        <div key={dim} className="space-y-1">
          <Label className="text-xs font-mono text-muted-foreground">{humanize(dim)}</Label>
          <div className="flex flex-wrap gap-1">
            {vals.map(v => {
              const sel = (profile[dim] || []).includes(v);
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => toggleVal(dim, v)}
                  className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                    sel
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-transparent bg-muted/40 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {humanize(v)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AdminDatasets() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DatasetForm>({ ...emptyForm });
  const [stages, setStages] = useState<PipelineStageForm[]>([]);
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [dialogTab, setDialogTab] = useState("identity");
  const [linkedCampaigns, setLinkedCampaigns] = useState<string[]>([]);

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

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setStages([]);
    setLinkedCampaigns([]);
    setDialogTab("identity");
    setDialogOpen(true);
  };

  const openEdit = async (dataset: any) => {
    setEditingId(dataset.id);
    setForm({
      name: dataset.name || "",
      slug: dataset.slug || "",
      status: dataset.status || "draft",
      modalities: dataset.modalities || dataset.content_types || [],
      task_family: dataset.task_family || "",
      task_type: dataset.task_type || "",
      source_type: dataset.source_type || "",
      consent_status: dataset.consent_status || "pending_review",
      legal_review_status: dataset.legal_review_status || "pending",
      annotation_status: dataset.annotation_status || "none",
      qc_status: dataset.qc_status || "pending",
      policy_profile: dataset.policy_profile || "",
      splits: dataset.splits || [],
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
      video_profile: dataset.video_profile || {},
      audio_profile: dataset.audio_profile || {},
      image_profile: dataset.image_profile || {},
      text_profile: dataset.text_profile || {},
    });

    const { data: stagesData } = await supabase
      .from("dataset_pipeline_stages")
      .select("*")
      .eq("dataset_id", dataset.id)
      .order("sort_order");

    setStages((stagesData ?? []).map((s: any) => ({
      id: s.id, stage_key: s.stage_key, label: s.label,
      sort_order: s.sort_order, stage_type: s.stage_type,
      description: s.description || "",
      automation_config: s.automation_config ? JSON.stringify(s.automation_config) : "",
    })));

    const { data: links } = await supabase
      .from("dataset_campaigns")
      .select("campaign_id")
      .eq("dataset_id", dataset.id);
    setLinkedCampaigns((links ?? []).map((l: any) => l.campaign_id));

    setDialogTab("identity");
    setDialogOpen(true);
  };

  const updateField = (field: keyof DatasetForm, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const toggleArray = (field: keyof DatasetForm, val: string) => {
    setForm(prev => {
      const arr = (prev[field] as string[]) || [];
      return {
        ...prev,
        [field]: arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val],
      };
    });
  };

  // Pipeline
  const addStage = () => {
    setStages(prev => [...prev, {
      stage_key: `stage_${prev.length + 1}`, label: "", sort_order: prev.length,
      stage_type: "manual", description: "", automation_config: "",
    }]);
  };
  const updateStage = (i: number, field: keyof PipelineStageForm, value: any) => {
    setStages(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s));
  };
  const removeStage = (i: number) => {
    setStages(prev => prev.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, sort_order: idx })));
  };
  const moveStage = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= stages.length) return;
    setStages(prev => {
      const arr = [...prev];
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr.map((s, idx) => ({ ...s, sort_order: idx }));
    });
  };

  const addTag = () => {
    const tag = tagInput.trim();
    if (tag && !form.tags.includes(tag)) updateField("tags", [...form.tags, tag]);
    setTagInput("");
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Nome é obrigatório"); return; }
    setSaving(true);
    try {
      const slug = form.slug || form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const payload: any = {
        name: form.name, slug, status: form.status,
        content_types: form.modalities, modalities: form.modalities,
        task_family: form.task_family || null, task_type: form.task_type || null,
        source_type: form.source_type || null,
        consent_status: form.consent_status, legal_review_status: form.legal_review_status,
        annotation_status: form.annotation_status, qc_status: form.qc_status,
        policy_profile: form.policy_profile || null, splits: form.splits,
        objective: form.objective || null, primary_task: form.primary_task || null,
        data_origin: form.data_origin || null, population_coverage: form.population_coverage || null,
        collection_process: form.collection_process || null,
        exclusion_criteria: form.exclusion_criteria || null,
        annotation_process: form.annotation_process || null,
        quality_metrics: form.quality_metrics || null,
        known_limitations: form.known_limitations || null, risks: form.risks || null,
        recommended_uses: form.recommended_uses || null,
        not_recommended_uses: form.not_recommended_uses || null,
        license_restrictions: form.license_restrictions || null,
        tags: form.tags,
        video_profile: form.video_profile, audio_profile: form.audio_profile,
        image_profile: form.image_profile, text_profile: form.text_profile,
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

      if (datasetId) {
        const existingIds = stages.filter(s => s.id).map(s => s.id!);
        if (editingId) {
          await supabase.from("dataset_pipeline_stages").delete()
            .eq("dataset_id", datasetId)
            .not("id", "in", `(${existingIds.join(",")})`);
        }
        for (const stage of stages) {
          const sp: any = {
            dataset_id: datasetId, stage_key: stage.stage_key, label: stage.label,
            sort_order: stage.sort_order, stage_type: stage.stage_type,
            description: stage.description || null,
            automation_config: stage.automation_config ? JSON.parse(stage.automation_config) : null,
          };
          if (stage.id) await supabase.from("dataset_pipeline_stages").update(sp).eq("id", stage.id);
          else await supabase.from("dataset_pipeline_stages").insert(sp);
        }

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

  // ── Render ────────────────────────────────────────────────────────
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
          {datasets.map((ds: any) => {
            const mods = ds.modalities?.length ? ds.modalities : ds.content_types || [];
            const st = DATASET_STATUS_STYLE[ds.status] || DATASET_STATUS_STYLE.draft;
            return (
              <Card key={ds.id} className="cursor-pointer hover:border-primary/30 transition-colors" onClick={() => openEdit(ds)}>
                <CardContent className="pt-5 pb-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold truncate">{ds.name}</h3>
                      {ds.slug && <p className="text-xs text-muted-foreground font-mono">{ds.slug}</p>}
                    </div>
                    <Badge className={st.className} variant="outline">{st.label}</Badge>
                  </div>

                  {ds.objective && <p className="text-xs text-muted-foreground line-clamp-2">{ds.objective}</p>}

                  <div className="flex flex-wrap gap-1.5">
                    {mods.map((m: string) => {
                      const Icon = MODALITY_ICONS[m] || Layers;
                      return (
                        <Badge key={m} variant="secondary" className="text-[10px] gap-1">
                          <Icon className="h-3 w-3" /> {humanize(m)}
                        </Badge>
                      );
                    })}
                    {ds.task_family && (
                      <Badge variant="outline" className="text-[10px]">{humanize(ds.task_family)}</Badge>
                    )}
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
            );
          })}
        </div>
      )}

      {/* ══════ Dialog ══════ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-5 pb-3 border-b border-border/40">
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              {editingId ? "Editar Dataset" : "Novo Dataset"}
            </DialogTitle>
          </DialogHeader>

          <Tabs value={dialogTab} onValueChange={setDialogTab} className="flex-1 flex flex-col min-h-0">
            <TabsList className="grid grid-cols-7 w-full rounded-none border-b border-border/40 bg-muted/30 h-auto px-2 py-1">
              <TabsTrigger value="identity" className="text-xs py-1.5">Identidade</TabsTrigger>
              <TabsTrigger value="datacard" className="text-xs py-1.5">Datacard</TabsTrigger>
              <TabsTrigger value="classification" className="text-xs py-1.5">Classificação</TabsTrigger>
              <TabsTrigger value="profiles" className="text-xs py-1.5">Perfis</TabsTrigger>
              <TabsTrigger value="pipeline" className="text-xs py-1.5">Pipeline</TabsTrigger>
              <TabsTrigger value="governance" className="text-xs py-1.5">Governança</TabsTrigger>
              <TabsTrigger value="campaigns" className="text-xs py-1.5">Campanhas</TabsTrigger>
            </TabsList>

            <ScrollArea className="flex-1">
              <div className="p-6">

                {/* ═══ IDENTITY ═══ */}
                <TabsContent value="identity" className="space-y-4 mt-0">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Nome *</Label>
                      <Input value={form.name} onChange={e => updateField("name", e.target.value)} placeholder="Ex: Brazilian Portuguese Conversations v1" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Slug</Label>
                      <Input value={form.slug} onChange={e => updateField("slug", e.target.value)} placeholder="auto-gerado" className="font-mono text-sm" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Status</Label>
                      <Select value={form.status} onValueChange={v => updateField("status", v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {DATASET_STATUSES.map(s => (
                            <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Policy Profile</Label>
                      <Select value={form.policy_profile || "_none"} onValueChange={v => updateField("policy_profile", v === "_none" ? "" : v)}>
                        <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">Nenhum</SelectItem>
                          {POLICY_PROFILES.map(p => (
                            <SelectItem key={p} value={p}>{humanize(p)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Modalidades</Label>
                    <PillSelect options={MODALITIES} selected={form.modalities} onToggle={v => toggleArray("modalities", v)} columns={6} />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Objetivo</Label>
                    <Textarea value={form.objective} onChange={e => updateField("objective", e.target.value)} placeholder="Qual o propósito deste dataset?" rows={2} />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Tags</Label>
                    <div className="flex gap-2">
                      <Input value={tagInput} onChange={e => setTagInput(e.target.value)}
                        placeholder="Adicionar tag..." onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addTag())} className="flex-1" />
                      <Button type="button" onClick={addTag} size="sm" variant="outline"><Tag className="h-3.5 w-3.5" /></Button>
                    </div>
                    {form.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {form.tags.map(tag => (
                          <Badge key={tag} variant="secondary" className="gap-1 text-xs cursor-pointer hover:bg-destructive/20" onClick={() => updateField("tags", form.tags.filter(t => t !== tag))}>
                            {tag} ×
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>

                {/* ═══ DATACARD ═══ */}
                <TabsContent value="datacard" className="space-y-4 mt-0">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Origem dos dados</Label>
                      <Textarea value={form.data_origin} onChange={e => updateField("data_origin", e.target.value)} placeholder="De onde vêm os dados?" rows={2} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>População / Cobertura</Label>
                      <Textarea value={form.population_coverage} onChange={e => updateField("population_coverage", e.target.value)} rows={2} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Processo de coleta</Label>
                    <Textarea value={form.collection_process} onChange={e => updateField("collection_process", e.target.value)} rows={2} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Critérios de exclusão</Label>
                      <Textarea value={form.exclusion_criteria} onChange={e => updateField("exclusion_criteria", e.target.value)} rows={2} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Processo de anotação</Label>
                      <Textarea value={form.annotation_process} onChange={e => updateField("annotation_process", e.target.value)} rows={2} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Métricas de qualidade</Label>
                    <Textarea value={form.quality_metrics} onChange={e => updateField("quality_metrics", e.target.value)} rows={2} />
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
                    <Textarea value={form.license_restrictions} onChange={e => updateField("license_restrictions", e.target.value)} rows={2} />
                  </div>
                </TabsContent>

                {/* ═══ CLASSIFICATION ═══ */}
                <TabsContent value="classification" className="space-y-5 mt-0">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Task Family</Label>
                      <Select value={form.task_family || "_none"} onValueChange={v => updateField("task_family", v === "_none" ? "" : v)}>
                        <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">Nenhum</SelectItem>
                          {TASK_FAMILIES.map(f => (
                            <SelectItem key={f} value={f}>{humanize(f)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Task Type</Label>
                      <Select value={form.task_type || "_none"} onValueChange={v => updateField("task_type", v === "_none" ? "" : v)}>
                        <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">Nenhum</SelectItem>
                          {TASK_TYPES.map(t => (
                            <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Tarefa principal (texto livre)</Label>
                    <Input value={form.primary_task} onChange={e => updateField("primary_task", e.target.value)} placeholder="Ex: ASR, TTS, Diarization..." />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Source Type</Label>
                    <Select value={form.source_type || "_none"} onValueChange={v => updateField("source_type", v === "_none" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">Nenhum</SelectItem>
                        {SOURCE_TYPES.map(s => (
                          <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Splits</Label>
                    <PillSelect options={SPLITS} selected={form.splits} onToggle={v => toggleArray("splits", v)} columns={7} />
                  </div>
                </TabsContent>

                {/* ═══ PROFILES ═══ */}
                <TabsContent value="profiles" className="space-y-5 mt-0">
                  <p className="text-sm text-muted-foreground">
                    Selecione os valores aceitáveis para cada dimensão de perfil. Isso define os critérios de qualidade e filtragem do dataset.
                  </p>

                  {(form.modalities.includes("audio") || form.modalities.includes("multimodal") || form.modalities.includes("mixed")) && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold flex items-center gap-2"><FileAudio className="h-4 w-4" /> Perfil de Áudio</h3>
                      <ProfileEditor dimensions={AUDIO_PROFILE_DIMENSIONS} profile={form.audio_profile} onChange={p => updateField("audio_profile", p)} />
                    </div>
                  )}

                  {(form.modalities.includes("video") || form.modalities.includes("multimodal") || form.modalities.includes("mixed")) && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold flex items-center gap-2"><FileVideo className="h-4 w-4" /> Perfil de Vídeo</h3>
                      <ProfileEditor dimensions={VIDEO_PROFILE_DIMENSIONS} profile={form.video_profile} onChange={p => updateField("video_profile", p)} />
                    </div>
                  )}

                  {(form.modalities.includes("image") || form.modalities.includes("multimodal") || form.modalities.includes("mixed")) && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold flex items-center gap-2"><Image className="h-4 w-4" /> Perfil de Imagem</h3>
                      <ProfileEditor dimensions={IMAGE_PROFILE_DIMENSIONS} profile={form.image_profile} onChange={p => updateField("image_profile", p)} />
                    </div>
                  )}

                  {(form.modalities.includes("text") || form.modalities.includes("multimodal") || form.modalities.includes("mixed")) && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold flex items-center gap-2"><FileText className="h-4 w-4" /> Perfil de Texto</h3>
                      <ProfileEditor dimensions={TEXT_PROFILE_DIMENSIONS} profile={form.text_profile} onChange={p => updateField("text_profile", p)} />
                    </div>
                  )}

                  {form.modalities.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      Selecione modalidades na aba "Identidade" para configurar os perfis.
                    </div>
                  )}
                </TabsContent>

                {/* ═══ PIPELINE ═══ */}
                <TabsContent value="pipeline" className="space-y-4 mt-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      Defina as etapas do pipeline. Os itens passarão por cada etapa na ordem.
                    </p>
                    <Button onClick={addStage} size="sm" variant="outline" className="gap-1">
                      <Plus className="h-3.5 w-3.5" /> Etapa
                    </Button>
                  </div>

                  {stages.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      <Layers className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      Nenhuma etapa definida.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {stages.map((stage, idx) => (
                        <div key={idx} className="border border-border/50 rounded-lg p-3 space-y-2 bg-card">
                          <div className="flex items-center gap-2">
                            <div className="flex flex-col gap-0.5">
                              <button type="button" onClick={() => moveStage(idx, -1)} disabled={idx === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-20 text-xs">▲</button>
                              <button type="button" onClick={() => moveStage(idx, 1)} disabled={idx === stages.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-20 text-xs">▼</button>
                            </div>
                            <span className="text-xs font-mono text-muted-foreground w-6">{idx + 1}.</span>
                            <Input value={stage.label} onChange={e => updateStage(idx, "label", e.target.value)} placeholder="Nome da etapa" className="flex-1 h-8 text-sm" />
                            <Select value={stage.stage_type} onValueChange={v => updateStage(idx, "stage_type", v)}>
                              <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="manual">Manual</SelectItem>
                                <SelectItem value="automated">Automatizado</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button variant="ghost" size="icon" onClick={() => removeStage(idx)} className="h-8 w-8 text-muted-foreground hover:text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          <div className="grid grid-cols-2 gap-2 pl-8">
                            <Input value={stage.stage_key} onChange={e => updateStage(idx, "stage_key", e.target.value)} placeholder="stage_key" className="h-7 text-xs font-mono" />
                            <Input value={stage.description} onChange={e => updateStage(idx, "description", e.target.value)} placeholder="Descrição breve" className="h-7 text-xs" />
                          </div>
                          {stage.stage_type === "automated" && (
                            <div className="pl-8">
                              <Input value={stage.automation_config} onChange={e => updateStage(idx, "automation_config", e.target.value)} placeholder='{"action": "analyze-content"}' className="h-7 text-xs font-mono" />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* ═══ GOVERNANCE ═══ */}
                <TabsContent value="governance" className="space-y-5 mt-0">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Consent Status</Label>
                      <Select value={form.consent_status} onValueChange={v => updateField("consent_status", v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CONSENT_STATUSES.map(s => (
                            <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Legal Review</Label>
                      <Select value={form.legal_review_status} onValueChange={v => updateField("legal_review_status", v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {LEGAL_REVIEW_STATUSES.map(s => (
                            <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Annotation Status</Label>
                      <Select value={form.annotation_status} onValueChange={v => updateField("annotation_status", v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ANNOTATION_STATUSES.map(s => (
                            <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>QC Status</Label>
                      <Select value={form.qc_status} onValueChange={v => updateField("qc_status", v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {QC_STATUSES.map(s => (
                            <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </TabsContent>

                {/* ═══ CAMPAIGNS ═══ */}
                <TabsContent value="campaigns" className="space-y-4 mt-0">
                  <p className="text-sm text-muted-foreground">
                    Vincule campanhas que alimentam este dataset.
                  </p>
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {campaigns?.map((c: any) => (
                      <div key={c.id}
                        className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors ${
                          linkedCampaigns.includes(c.id) ? "border-primary/40 bg-primary/5" : "border-border/50 hover:border-border"
                        }`}
                        onClick={() => setLinkedCampaigns(prev => prev.includes(c.id) ? prev.filter(x => x !== c.id) : [...prev, c.id])}
                      >
                        <Checkbox checked={linkedCampaigns.includes(c.id)} />
                        <span className="text-sm">{c.name}</span>
                      </div>
                    ))}
                    {!campaigns?.length && <p className="text-muted-foreground text-sm text-center py-4">Nenhuma campanha disponível</p>}
                  </div>
                </TabsContent>
              </div>
            </ScrollArea>
          </Tabs>

          <div className="flex justify-end gap-2 px-6 py-4 border-t border-border/50">
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
