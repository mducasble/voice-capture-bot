import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  Database, ArrowRight, Loader2, RefreshCw, CheckCircle2, Clock, Mic2, FileText, Package,
} from "lucide-react";

const PIPELINE_STAGES = [
  { key: "quality_approved", label: "Qualidade Aprovada", color: "bg-blue-500/20 text-blue-400" },
  { key: "content_validated", label: "Conteúdo Validado", color: "bg-indigo-500/20 text-indigo-400" },
  { key: "transcription_queued", label: "Transcrição na Fila", color: "bg-yellow-500/20 text-yellow-400" },
  { key: "transcribed", label: "Transcrito", color: "bg-emerald-500/20 text-emerald-400" },
  { key: "dataset_ready", label: "Dataset Ready", color: "bg-green-500/20 text-green-300" },
  { key: "standby", label: "Standby", color: "bg-muted text-muted-foreground" },
] as const;

type PipelineStats = Record<string, number>;

export default function AdminDatasetPipeline() {
  const queryClient = useQueryClient();
  const [campaignId, setCampaignId] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [queueingTranscription, setQueueingTranscription] = useState(false);

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
  const readyCount = stats?.dataset_ready ?? 0;

  // Campaigns
  const { data: campaigns } = useQuery({
    queryKey: ["campaigns-list-simple"],
    queryFn: async () => {
      const { data } = await supabase.from("campaigns").select("id, name").order("name");
      return data ?? [];
    },
  });

  // Recent items
  const { data: recentItems } = useQuery({
    queryKey: ["dataset-pipeline-recent"],
    queryFn: async () => {
      const { data } = await supabase
        .from("dataset_items")
        .select("id, submission_id, submission_type, pipeline_status, quality_tier, campaign_id, has_flagged_tracks, created_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(30);
      return data ?? [];
    },
    refetchInterval: 15_000,
  });

  // Ingest: find approved recordings not yet in dataset_items
  const ingestFromCampaign = async () => {
    if (!campaignId) { toast.error("Selecione uma campanha"); return; }
    setIngesting(true);
    try {
      // Get approved recordings
      const { data: recordings, error } = await supabase
        .from("voice_recordings" as any)
        .select("id, user_id, campaign_id, quality_status, validation_status, metadata, duration_seconds")
        .eq("campaign_id", campaignId)
        .eq("quality_status", "approved")
        .eq("recording_type", "individual");

      if (error) throw error;
      if (!recordings?.length) {
        toast.info("Nenhuma gravação aprovada encontrada");
        setIngesting(false);
        return;
      }

      // Filter out already ingested
      const recIds = recordings.map((r: any) => r.id);
      const { data: existing } = await supabase
        .from("dataset_items")
        .select("submission_id")
        .in("submission_id", recIds)
        .eq("submission_type", "audio");

      const existingIds = new Set((existing ?? []).map((e: any) => e.submission_id));
      const toIngest = recordings.filter((r: any) => !existingIds.has(r.id));

      if (!toIngest.length) {
        toast.info("Todas as gravações aprovadas já estão no pipeline");
        setIngesting(false);
        return;
      }

      // Determine quality tier and check for track flags
      const items = toIngest.map((r: any) => {
        const meta = r.metadata || {};
        const qualityTier = meta.quality_tier || null;
        const hasFlag = !!meta.track_flag_reason;
        
        // Determine initial pipeline_status based on available data
        let pipelineStatus = "quality_approved";
        if (meta.content_analysis || meta.gemini_transcript) {
          pipelineStatus = "content_validated";
        }
        if (meta.elevenlabs_words && (meta.elevenlabs_words as any[]).length > 0) {
          pipelineStatus = "transcribed";
        }

        return {
          submission_id: r.id,
          submission_type: "audio",
          campaign_id: r.campaign_id,
          user_id: r.user_id,
          pipeline_status: pipelineStatus,
          quality_approved_at: new Date().toISOString(),
          quality_tier: qualityTier,
          content_validated_at: pipelineStatus !== "quality_approved" ? new Date().toISOString() : null,
          transcription_completed_at: pipelineStatus === "transcribed" ? new Date().toISOString() : null,
          transcription_provider: pipelineStatus === "transcribed" ? "elevenlabs" : null,
          has_flagged_tracks: hasFlag,
        };
      });

      // Insert in batches
      for (let i = 0; i < items.length; i += 50) {
        const batch = items.slice(i, i + 50);
        const { error: insertErr } = await supabase
          .from("dataset_items")
          .insert(batch);
        if (insertErr) throw insertErr;
      }

      toast.success(`${items.length} items ingeridos no pipeline`);
      queryClient.invalidateQueries({ queryKey: ["dataset-pipeline-stats"] });
      queryClient.invalidateQueries({ queryKey: ["dataset-pipeline-recent"] });
    } catch (err) {
      toast.error("Erro: " + (err as Error).message);
    }
    setIngesting(false);
  };

  // Queue transcription for content_validated items
  const queueTranscription = async () => {
    setQueueingTranscription(true);
    try {
      const filter: any = { pipeline_status: "content_validated" };
      let query = supabase
        .from("dataset_items")
        .select("id, submission_id")
        .eq("pipeline_status", "content_validated");

      if (campaignId) query = query.eq("campaign_id", campaignId);
      
      const { data: items, error } = await query.limit(100);
      if (error) throw error;
      if (!items?.length) {
        toast.info("Nenhum item pendente de transcrição");
        setQueueingTranscription(false);
        return;
      }

      // Enqueue each into analysis_queue with job_type 'transcribe_elevenlabs'
      const { data: { user } } = await supabase.auth.getUser();
      const toQueue = items.map((item: any) => ({
        recording_id: item.submission_id,
        status: "pending",
        job_type: "transcribe_elevenlabs",
        created_by: user?.id,
      }));

      for (let i = 0; i < toQueue.length; i += 50) {
        const batch = toQueue.slice(i, i + 50);
        const { error: insertErr } = await supabase
          .from("analysis_queue")
          .insert(batch);
        if (insertErr) throw insertErr;
      }

      // Update dataset_items to transcription_queued
      const ids = items.map((i: any) => i.id);
      await supabase
        .from("dataset_items")
        .update({ pipeline_status: "transcription_queued", transcription_queued_at: new Date().toISOString() })
        .in("id", ids);

      toast.success(`${items.length} items enfileirados para transcrição`);
      queryClient.invalidateQueries({ queryKey: ["dataset-pipeline-stats"] });
      queryClient.invalidateQueries({ queryKey: ["dataset-pipeline-recent"] });
    } catch (err) {
      toast.error("Erro: " + (err as Error).message);
    }
    setQueueingTranscription(false);
  };

  // Mark transcribed items as dataset_ready
  const promoteToReady = async () => {
    const { data, error } = await supabase
      .from("dataset_items")
      .update({
        pipeline_status: "dataset_ready",
      })
      .eq("pipeline_status", "transcribed")
      .eq("has_flagged_tracks", false)
      .select("id");

    if (error) {
      toast.error("Erro ao promover");
    } else {
      toast.success(`${data?.length ?? 0} items marcados como Dataset Ready`);
      queryClient.invalidateQueries({ queryKey: ["dataset-pipeline-stats"] });
      queryClient.invalidateQueries({ queryKey: ["dataset-pipeline-recent"] });
    }
  };

  const stageColor = Object.fromEntries(PIPELINE_STAGES.map(s => [s.key, s.color]));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Database className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Dataset Pipeline</h1>
        <Badge variant="outline" className="ml-auto text-sm">
          {total} items total • {readyCount} dataset ready
        </Badge>
      </div>

      {/* Pipeline funnel */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {PIPELINE_STAGES.map((stage) => (
          <Card key={stage.key} className="relative overflow-hidden">
            <CardContent className="pt-4 pb-4">
              <div className="text-xs text-muted-foreground mb-1">{stage.label}</div>
              <div className="text-2xl font-bold">{statsLoading ? "—" : stats?.[stage.key] ?? 0}</div>
              {total > 0 && (
                <Progress
                  value={((stats?.[stage.key] ?? 0) / total) * 100}
                  className="h-1 mt-2"
                />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Ingest + Actions */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-5 w-5" />
              Ingerir Gravações Aprovadas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select value={campaignId} onValueChange={setCampaignId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma campanha" />
              </SelectTrigger>
              <SelectContent>
                {campaigns?.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={ingestFromCampaign} disabled={ingesting || !campaignId} className="w-full">
              {ingesting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Ingerir no Pipeline
            </Button>
            <p className="text-xs text-muted-foreground">
              Importa gravações aprovadas e detecta automaticamente em qual etapa estão (qualidade, conteúdo ou transcrição).
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Mic2 className="h-5 w-5" />
              Ações do Pipeline
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={queueTranscription} disabled={queueingTranscription} variant="outline" className="w-full justify-start">
              {queueingTranscription ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
              Enfileirar Transcrição ElevenLabs
            </Button>
            <Button onClick={promoteToReady} variant="outline" className="w-full justify-start">
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Promover Transcritos → Dataset Ready
            </Button>
            <p className="text-xs text-muted-foreground">
              Items com tracks flagueadas não são promovidos automaticamente.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recent items */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Items Recentes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {recentItems?.map((item: any) => (
              <div key={item.id} className="flex items-center justify-between text-sm border-b border-border/50 py-2">
                <div className="flex items-center gap-3">
                  <Badge className={stageColor[item.pipeline_status] || ""} variant="outline">
                    {PIPELINE_STAGES.find(s => s.key === item.pipeline_status)?.label || item.pipeline_status}
                  </Badge>
                  <Badge variant="secondary" className="text-xs">{item.submission_type}</Badge>
                  {item.quality_tier && (
                    <span className="text-xs font-mono text-muted-foreground">{item.quality_tier}</span>
                  )}
                  {item.has_flagged_tracks && (
                    <Badge variant="outline" className="bg-amber-500/20 text-amber-400 text-xs">flagged</Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="font-mono">{item.submission_id?.slice(0, 8)}</span>
                  <span>{new Date(item.updated_at).toLocaleString("pt-BR")}</span>
                </div>
              </div>
            ))}
            {!recentItems?.length && (
              <p className="text-muted-foreground text-sm">Nenhum item no pipeline</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
