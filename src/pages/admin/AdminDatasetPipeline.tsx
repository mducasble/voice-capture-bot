import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Database, Loader2, CheckCircle2, Clock, Package, ArrowRight, RotateCcw,
  ChevronRight, AlertTriangle, Flag, Brain,
} from "lucide-react";

const PIPELINE_STAGES = [
  { key: "quality_approved", label: "Qualidade Aprovada", next: "content_validated", nextLabel: "Validar Conteúdo", color: "bg-blue-500/20 text-blue-400", dotColor: "bg-blue-400" },
  { key: "content_validated", label: "Conteúdo Validado", next: "transcription_queued", nextLabel: "Enfileirar Transcrição", color: "bg-indigo-500/20 text-indigo-400", dotColor: "bg-indigo-400" },
  { key: "transcription_queued", label: "Na Fila", next: "transcribed", nextLabel: "Marcar Transcrito", color: "bg-yellow-500/20 text-yellow-400", dotColor: "bg-yellow-400" },
  { key: "transcribed", label: "Transcrito", next: "dataset_ready", nextLabel: "Dataset Ready ✓", color: "bg-emerald-500/20 text-emerald-400", dotColor: "bg-emerald-400" },
  { key: "dataset_ready", label: "Dataset Ready", next: null, nextLabel: null, color: "bg-green-500/20 text-green-300", dotColor: "bg-green-400" },
  { key: "standby", label: "Standby", next: null, nextLabel: null, color: "bg-muted text-muted-foreground", dotColor: "bg-muted-foreground" },
] as const;

type PipelineStats = Record<string, number>;

export default function AdminDatasetPipeline() {
  const queryClient = useQueryClient();
  const [campaignId, setCampaignId] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [activeTab, setActiveTab] = useState("quality_approved");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [advancing, setAdvancing] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<{ current: number; total: number; results: any[] } | null>(null);

  // Pipeline stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["dataset-pipeline-stats"],
    queryFn: async (): Promise<PipelineStats> => {
      const results: PipelineStats = {};
      for (const s of PIPELINE_STAGES) {
        const { count } = await supabase
          .from("dataset_items")
          .select("id", { count: "exact", head: true })
          .eq("pipeline_status", s.key);
        results[s.key] = count ?? 0;
      }
      return results;
    },
    refetchInterval: 15_000,
  });

  const total = stats ? Object.values(stats).reduce((a, b) => a + b, 0) : 0;

  // Campaigns
  const { data: campaigns } = useQuery({
    queryKey: ["campaigns-list-simple"],
    queryFn: async () => {
      const { data } = await supabase.from("campaigns").select("id, name").order("name");
      return data ?? [];
    },
  });

  // Items for active tab
  const { data: tabItems, isLoading: itemsLoading } = useQuery({
    queryKey: ["dataset-pipeline-items", activeTab],
    queryFn: async () => {
      const { data } = await supabase
        .from("dataset_items")
        .select("id, submission_id, submission_type, pipeline_status, quality_tier, campaign_id, has_flagged_tracks, flagged_track_ids, notes, tags, created_at, updated_at, transcription_provider, content_score")
        .eq("pipeline_status", activeTab)
        .order("created_at", { ascending: false })
        .limit(200);
      return data ?? [];
    },
    refetchInterval: 15_000,
  });

  // Campaign name map
  const campaignNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    campaigns?.forEach((c: any) => { map[c.id] = c.name; });
    return map;
  }, [campaigns]);

  const currentStage = PIPELINE_STAGES.find(s => s.key === activeTab);

  // Select all / none
  const allSelected = tabItems?.length ? tabItems.every((i: any) => selectedIds.has(i.id)) : false;
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tabItems?.map((i: any) => i.id) ?? []));
    }
  };
  const toggleItem = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  // Reset selection on tab change
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setSelectedIds(new Set());
  };

  // Advance selected items to next stage
  const advanceSelected = async () => {
    if (!currentStage?.next || selectedIds.size === 0) return;
    setAdvancing(true);
    try {
      const ids = Array.from(selectedIds);
      const items = tabItems?.filter((i: any) => selectedIds.has(i.id)) ?? [];
      const now = new Date().toISOString();

      // If advancing to content_validated, trigger Gemini analysis first
      if (currentStage.next === "content_validated") {
        setAnalysisProgress({ current: 0, total: items.length, results: [] });
        const results: any[] = [];

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          setAnalysisProgress(prev => prev ? { ...prev, current: i + 1 } : null);

          try {
            const { data, error } = await supabase.functions.invoke("analyze-content", {
              body: { recording_id: item.submission_id },
            });

            if (error) {
              results.push({ id: item.id, submission_id: item.submission_id, success: false, error: error.message });
            } else if (data?.error) {
              results.push({ id: item.id, submission_id: item.submission_id, success: false, error: data.error });
            } else {
              const analysis = data?.analysis;
              // Update dataset_item with content_score
              await supabase.from("dataset_items").update({
                pipeline_status: "content_validated",
                content_validated_at: now,
                content_score: analysis ? {
                  topic_adherence_percent: analysis.topic_adherence_percent,
                  speakers: analysis.speakers,
                  content_summary: analysis.content_summary,
                  off_topic_summary: analysis.off_topic_summary,
                } : null,
              }).eq("id", item.id);

              results.push({
                id: item.id,
                submission_id: item.submission_id,
                success: true,
                topic_adherence: analysis?.topic_adherence_percent,
                speakers: analysis?.speakers,
                summary: analysis?.content_summary,
              });
            }
          } catch (err) {
            results.push({ id: item.id, submission_id: item.submission_id, success: false, error: (err as Error).message });
          }

          // Small delay to avoid rate limiting
          if (i < items.length - 1) await new Promise(r => setTimeout(r, 1500));
        }

        setAnalysisProgress(prev => prev ? { ...prev, results } : null);
        const successCount = results.filter(r => r.success).length;
        toast.success(`Análise concluída: ${successCount}/${items.length} validados pelo Gemini`);
        setSelectedIds(new Set());
        queryClient.invalidateQueries({ queryKey: ["dataset-pipeline-stats"] });
        queryClient.invalidateQueries({ queryKey: ["dataset-pipeline-items"] });
        setAdvancing(false);
        return;
      }

      // For other stages, just update status
      const updateData: Record<string, any> = { pipeline_status: currentStage.next };
      if (currentStage.next === "transcription_queued") updateData.transcription_queued_at = now;
      if (currentStage.next === "transcribed") updateData.transcription_completed_at = now;

      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const { error } = await supabase.from("dataset_items").update(updateData).in("id", batch);
        if (error) throw error;
      }

      // If advancing to transcription_queued, also enqueue in analysis_queue
      if (currentStage.next === "transcription_queued") {
        const { data: { user } } = await supabase.auth.getUser();
        const toQueue = items.map((item: any) => ({
          recording_id: item.submission_id,
          status: "pending",
          job_type: "transcribe_elevenlabs",
          created_by: user?.id,
        }));
        for (let i = 0; i < toQueue.length; i += 50) {
          await supabase.from("analysis_queue").insert(toQueue.slice(i, i + 50));
        }
      }

      toast.success(`${ids.length} items avançados para "${PIPELINE_STAGES.find(s => s.key === currentStage.next)?.label}"`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["dataset-pipeline-stats"] });
      queryClient.invalidateQueries({ queryKey: ["dataset-pipeline-items"] });
    } catch (err) {
      toast.error("Erro: " + (err as Error).message);
    }
    setAdvancing(false);
  };

  // Move selected to standby
  const moveToStandby = async () => {
    if (selectedIds.size === 0) return;
    setAdvancing(true);
    try {
      const ids = Array.from(selectedIds);
      for (let i = 0; i < ids.length; i += 50) {
        await supabase.from("dataset_items").update({ pipeline_status: "standby" }).in("id", ids.slice(i, i + 50));
      }
      toast.success(`${ids.length} items movidos para Standby`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["dataset-pipeline-stats"] });
      queryClient.invalidateQueries({ queryKey: ["dataset-pipeline-items"] });
    } catch (err) {
      toast.error("Erro: " + (err as Error).message);
    }
    setAdvancing(false);
  };

  // Re-scan: check metadata and update pipeline_status accordingly
  const rescanItems = async () => {
    setRescanning(true);
    try {
      // Get all items that aren't dataset_ready or standby
      const { data: items, error } = await supabase
        .from("dataset_items")
        .select("id, submission_id, pipeline_status")
        .in("pipeline_status", ["quality_approved", "content_validated", "transcription_queued"]);

      if (error) throw error;
      if (!items?.length) { toast.info("Nenhum item para re-escanear"); setRescanning(false); return; }

      // Fetch voice_recordings metadata for these
      const subIds = items.map((i: any) => i.submission_id);
      const { data: recordings } = await supabase
        .from("voice_recordings" as any)
        .select("id, metadata")
        .in("id", subIds);

      const metaMap: Record<string, any> = {};
      recordings?.forEach((r: any) => { metaMap[r.id] = r.metadata || {}; });

      let updated = 0;
      for (const item of items) {
        const meta = metaMap[item.submission_id] || {};
        let newStatus = item.pipeline_status;

        const hasContent = !!(meta.content_analysis || meta.gemini_transcript);
        const hasElevenlabs = !!(meta.elevenlabs_words && (meta.elevenlabs_words as any[]).length > 0);

        if (hasElevenlabs) newStatus = "transcribed";
        else if (hasContent && item.pipeline_status === "quality_approved") newStatus = "content_validated";

        if (newStatus !== item.pipeline_status) {
          const now = new Date().toISOString();
          const upd: Record<string, any> = { pipeline_status: newStatus };
          if (newStatus === "content_validated") upd.content_validated_at = now;
          if (newStatus === "transcribed") { upd.transcription_completed_at = now; upd.transcription_provider = "elevenlabs"; }

          await supabase.from("dataset_items").update(upd).eq("id", item.id);
          updated++;
        }
      }

      toast.success(`Re-scan concluído: ${updated} items atualizados`);
      queryClient.invalidateQueries({ queryKey: ["dataset-pipeline-stats"] });
      queryClient.invalidateQueries({ queryKey: ["dataset-pipeline-items"] });
    } catch (err) {
      toast.error("Erro: " + (err as Error).message);
    }
    setRescanning(false);
  };

  // Ingest
  const ingestFromCampaign = async () => {
    if (!campaignId) { toast.error("Selecione uma campanha"); return; }
    setIngesting(true);
    try {
      const { data: recordings, error } = await supabase
        .from("voice_recordings" as any)
        .select("id, user_id, campaign_id, metadata")
        .eq("campaign_id", campaignId)
        .eq("quality_status", "approved")
        .eq("recording_type", "individual");

      if (error) throw error;
      if (!recordings?.length) { toast.info("Nenhuma gravação aprovada"); setIngesting(false); return; }

      const recIds = recordings.map((r: any) => r.id);
      const { data: existing } = await supabase
        .from("dataset_items").select("submission_id").in("submission_id", recIds).eq("submission_type", "audio");
      const existingIds = new Set((existing ?? []).map((e: any) => e.submission_id));
      const toIngest = recordings.filter((r: any) => !existingIds.has(r.id));

      if (!toIngest.length) { toast.info("Tudo já está no pipeline"); setIngesting(false); return; }

      const items = toIngest.map((r: any) => {
        const meta = r.metadata || {};
        const hasContent = !!(meta.content_analysis || meta.gemini_transcript);
        const hasElevenlabs = !!(meta.elevenlabs_words && (meta.elevenlabs_words as any[]).length > 0);
        let status = "quality_approved";
        if (hasElevenlabs) status = "transcribed";
        else if (hasContent) status = "content_validated";

        return {
          submission_id: r.id,
          submission_type: "audio",
          campaign_id: r.campaign_id,
          user_id: r.user_id,
          pipeline_status: status,
          quality_approved_at: new Date().toISOString(),
          quality_tier: meta.quality_tier || null,
          content_validated_at: hasContent ? new Date().toISOString() : null,
          transcription_completed_at: hasElevenlabs ? new Date().toISOString() : null,
          transcription_provider: hasElevenlabs ? "elevenlabs" : null,
          has_flagged_tracks: !!meta.track_flag_reason,
        };
      });

      for (let i = 0; i < items.length; i += 50) {
        const { error: insertErr } = await supabase.from("dataset_items").insert(items.slice(i, i + 50));
        if (insertErr) throw insertErr;
      }

      toast.success(`${items.length} items ingeridos`);
      queryClient.invalidateQueries({ queryKey: ["dataset-pipeline-stats"] });
      queryClient.invalidateQueries({ queryKey: ["dataset-pipeline-items"] });
    } catch (err) {
      toast.error("Erro: " + (err as Error).message);
    }
    setIngesting(false);
  };

  const stageColor = Object.fromEntries(PIPELINE_STAGES.map(s => [s.key, s.color]));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Database className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Dataset Pipeline</h1>
        <Badge variant="outline" className="ml-auto text-sm">{total} items</Badge>
      </div>

      {/* Pipeline funnel */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {PIPELINE_STAGES.map((stage) => {
          const count = stats?.[stage.key] ?? 0;
          const isActive = activeTab === stage.key;
          return (
            <button
              key={stage.key}
              onClick={() => handleTabChange(stage.key)}
              className={`p-3 rounded-xl border transition-all text-left ${
                isActive
                  ? "border-primary/40 bg-primary/5"
                  : "border-border/50 bg-card hover:border-border"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className={`h-2 w-2 rounded-full ${stage.dotColor}`} />
                <span className="text-[11px] text-muted-foreground truncate">{stage.label}</span>
              </div>
              <div className="text-xl font-bold">{statsLoading ? "—" : count}</div>
            </button>
          );
        })}
      </div>

      {/* Ingest + Rescan bar */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground mb-1 block">Ingerir gravações aprovadas</label>
              <div className="flex gap-2">
                <Select value={campaignId} onValueChange={setCampaignId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Campanha" />
                  </SelectTrigger>
                  <SelectContent>
                    {campaigns?.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={ingestFromCampaign} disabled={ingesting || !campaignId} size="sm">
                  {ingesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <Button onClick={rescanItems} disabled={rescanning} variant="outline" size="sm">
              {rescanning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
              Re-scan Metadata
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Analysis Progress & Results */}
      {analysisProgress && (
        <Card className="border-primary/30">
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary animate-pulse" />
              <span className="text-sm font-medium">Análise de Conteúdo (Gemini)</span>
              <span className="text-xs text-muted-foreground ml-auto">
                {analysisProgress.current}/{analysisProgress.total}
              </span>
            </div>
            <Progress value={(analysisProgress.current / analysisProgress.total) * 100} className="h-2" />

            {/* Show results when done */}
            {analysisProgress.results.length > 0 && (
              <div className="space-y-2 mt-3 max-h-[300px] overflow-y-auto">
                {analysisProgress.results.map((r, idx) => (
                  <div key={idx} className={`text-xs rounded-lg p-3 border ${r.success ? "border-border/50 bg-card" : "border-destructive/30 bg-destructive/5"}`}>
                    <div className="flex items-center gap-2 mb-1">
                      {r.success ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                      )}
                      <span className="font-mono text-muted-foreground">{r.submission_id?.slice(0, 8)}</span>
                      {r.success && r.topic_adherence != null && (
                        <Badge variant="outline" className={`text-[10px] ml-auto ${
                          r.topic_adherence >= 70 ? "text-emerald-400 border-emerald-400/30" :
                          r.topic_adherence >= 40 ? "text-yellow-400 border-yellow-400/30" :
                          "text-destructive border-destructive/30"
                        }`}>
                          {r.topic_adherence}% no tema
                        </Badge>
                      )}
                    </div>
                    {r.success && r.summary && (
                      <p className="text-muted-foreground mt-1">{r.summary}</p>
                    )}
                    {r.success && r.speakers?.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-1.5">
                        {r.speakers.map((s: any, si: number) => (
                          <span key={si} className="bg-muted/50 px-1.5 py-0.5 rounded text-[10px]">
                            {s.name}: {s.speaking_time_percent}% fala
                          </span>
                        ))}
                      </div>
                    )}
                    {!r.success && <p className="text-destructive mt-1">{r.error}</p>}
                  </div>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setAnalysisProgress(null)} className="w-full text-xs">
                  Fechar resultados
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Items list with batch controls */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Badge className={currentStage ? stageColor[currentStage.key] : ""} variant="outline">
                {currentStage?.label}
              </Badge>
              <span className="text-muted-foreground font-normal text-sm">
                {tabItems?.length ?? 0} items
              </span>
            </CardTitle>

            {/* Batch actions */}
            <div className="flex items-center gap-2">
              {selectedIds.size > 0 && (
                <span className="text-xs text-muted-foreground">{selectedIds.size} selecionados</span>
              )}
              {currentStage?.next && selectedIds.size > 0 && (
                <Button onClick={advanceSelected} disabled={advancing} size="sm" className="gap-1">
                  {advancing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : activeTab === "quality_approved" ? <Brain className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  {activeTab === "quality_approved" ? "Analisar com Gemini" : currentStage.nextLabel}
                </Button>
              )}
              {selectedIds.size > 0 && activeTab !== "standby" && activeTab !== "dataset_ready" && (
                <Button onClick={moveToStandby} disabled={advancing} size="sm" variant="outline" className="gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Standby
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Select all */}
          {(tabItems?.length ?? 0) > 0 && (currentStage?.next || activeTab !== "dataset_ready") && (
            <div className="flex items-center gap-2 pb-3 border-b border-border/50 mb-2">
              <Checkbox
                checked={allSelected}
                onCheckedChange={toggleSelectAll}
                id="select-all"
              />
              <label htmlFor="select-all" className="text-xs text-muted-foreground cursor-pointer">
                Selecionar todos
              </label>
            </div>
          )}

          <div className="space-y-1 max-h-[500px] overflow-y-auto">
            {itemsLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {tabItems?.map((item: any) => (
              <div
                key={item.id}
                className={`flex items-center gap-3 py-2 px-2 rounded-lg transition-colors ${
                  selectedIds.has(item.id) ? "bg-primary/5" : "hover:bg-muted/30"
                }`}
              >
                {(currentStage?.next || activeTab === "standby") && (
                  <Checkbox
                    checked={selectedIds.has(item.id)}
                    onCheckedChange={() => toggleItem(item.id)}
                  />
                )}
                <div className="flex-1 flex items-center gap-3 min-w-0">
                  <Badge variant="secondary" className="text-[11px] shrink-0">{item.submission_type}</Badge>
                  {item.quality_tier && (
                    <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${
                      item.quality_tier === "PQ" ? "bg-green-500/20 text-green-400" :
                      item.quality_tier === "HQ" ? "bg-blue-500/20 text-blue-400" :
                      "bg-yellow-500/20 text-yellow-400"
                    }`}>
                      {item.quality_tier}
                    </span>
                  )}
                  {item.content_score && (item.content_score as any).topic_adherence_percent != null && (
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      (item.content_score as any).topic_adherence_percent >= 70 ? "bg-emerald-500/20 text-emerald-400" :
                      (item.content_score as any).topic_adherence_percent >= 40 ? "bg-yellow-500/20 text-yellow-400" :
                      "bg-destructive/20 text-destructive"
                    }`}>
                      {(item.content_score as any).topic_adherence_percent}% tema
                    </span>
                  )}
                  {item.has_flagged_tracks && (
                    <Flag className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  )}
                  {item.transcription_provider && (
                    <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                      {item.transcription_provider}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground truncate">
                    {campaignNameMap[item.campaign_id] || item.campaign_id?.slice(0, 8)}
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground font-mono shrink-0">
                  {item.submission_id?.slice(0, 8)}
                </span>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {new Date(item.updated_at).toLocaleDateString("pt-BR")}
                </span>
              </div>
            ))}
            {!itemsLoading && !tabItems?.length && (
              <p className="text-muted-foreground text-sm py-8 text-center">Nenhum item nesta etapa</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
