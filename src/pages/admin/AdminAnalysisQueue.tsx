import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, Play, Square, Loader2, RefreshCw, Trash2 } from "lucide-react";

type QueueStats = { pending: number; processing: number; done: number; failed: number };

export default function AdminAnalysisQueue() {
  const queryClient = useQueryClient();
  const [campaignId, setCampaignId] = useState("");
  const [enqueuing, setEnqueuing] = useState(false);

  // Queue stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["analysis-queue-stats"],
    queryFn: async (): Promise<QueueStats> => {
      const statuses = ["pending", "processing", "done", "failed"] as const;
      const results: QueueStats = { pending: 0, processing: 0, done: 0, failed: 0 };
      for (const s of statuses) {
        const { count } = await supabase
          .from("analysis_queue" as any)
          .select("id", { count: "exact", head: true })
          .eq("status", s);
        results[s] = count ?? 0;
      }
      return results;
    },
    refetchInterval: 10_000,
  });

  // Recent jobs
  const { data: recentJobs } = useQuery({
    queryKey: ["analysis-queue-recent"],
    queryFn: async () => {
      const { data } = await supabase
        .from("analysis_queue" as any)
        .select("id, recording_id, status, attempts, last_error, created_at, completed_at")
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
    refetchInterval: 10_000,
  });

  // Campaigns for selector
  const { data: campaigns } = useQuery({
    queryKey: ["campaigns-list-simple"],
    queryFn: async () => {
      const { data } = await supabase
        .from("campaigns")
        .select("id, name")
        .order("name");
      return data ?? [];
    },
  });

  const enqueueByCampaign = async () => {
    if (!campaignId) {
      toast.error("Selecione uma campanha");
      return;
    }
    setEnqueuing(true);
    try {
      // Get all recordings for this campaign that don't have metrics yet
      const { data: recordings, error } = await supabase
        .from("voice_recordings" as any)
        .select("id")
        .eq("campaign_id", campaignId)
        .is("metadata->metrics_estimated_at" as any, null);

      if (error) throw error;
      if (!recordings?.length) {
        toast.info("Nenhuma gravação pendente de análise nessa campanha");
        setEnqueuing(false);
        return;
      }

      // Check which are already in queue
      const recIds = recordings.map((r: any) => r.id);
      const { data: existing } = await supabase
        .from("analysis_queue" as any)
        .select("recording_id")
        .in("recording_id", recIds)
        .in("status", ["pending", "processing"]);

      const existingIds = new Set((existing ?? []).map((e: any) => e.recording_id));
      const toEnqueue = recIds.filter((id: string) => !existingIds.has(id));

      if (!toEnqueue.length) {
        toast.info("Todas as gravações já estão na fila");
        setEnqueuing(false);
        return;
      }

      // Insert in batches of 50
      const { data: { user } } = await supabase.auth.getUser();
      for (let i = 0; i < toEnqueue.length; i += 50) {
        const batch = toEnqueue.slice(i, i + 50).map((id: string) => ({
          recording_id: id,
          status: "pending",
          created_by: user?.id,
        }));
        const { error: insertErr } = await supabase
          .from("analysis_queue" as any)
          .insert(batch);
        if (insertErr) throw insertErr;
      }

      toast.success(`${toEnqueue.length} gravações adicionadas à fila`);
      queryClient.invalidateQueries({ queryKey: ["analysis-queue-stats"] });
      queryClient.invalidateQueries({ queryKey: ["analysis-queue-recent"] });
    } catch (err) {
      toast.error("Erro ao enfileirar: " + (err as Error).message);
    }
    setEnqueuing(false);
  };

  const clearCompleted = async () => {
    const { error } = await supabase
      .from("analysis_queue" as any)
      .delete()
      .in("status", ["done", "cancelled"]);
    if (error) {
      toast.error("Erro ao limpar");
    } else {
      toast.success("Fila limpa");
      queryClient.invalidateQueries({ queryKey: ["analysis-queue-stats"] });
      queryClient.invalidateQueries({ queryKey: ["analysis-queue-recent"] });
    }
  };

  const cancelAll = async () => {
    const { error } = await supabase
      .from("analysis_queue" as any)
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("status", "pending");
    if (error) {
      toast.error("Erro ao cancelar");
    } else {
      toast.success("Jobs pendentes cancelados");
      queryClient.invalidateQueries({ queryKey: ["analysis-queue-stats"] });
      queryClient.invalidateQueries({ queryKey: ["analysis-queue-recent"] });
    }
  };

  const retryFailed = async () => {
    const { error } = await supabase
      .from("analysis_queue" as any)
      .update({ status: "pending", attempts: 0, last_error: null, started_at: null, updated_at: new Date().toISOString() })
      .eq("status", "failed");
    if (error) {
      toast.error("Erro ao retentar");
    } else {
      toast.success("Jobs com falha recolocados na fila");
      queryClient.invalidateQueries({ queryKey: ["analysis-queue-stats"] });
      queryClient.invalidateQueries({ queryKey: ["analysis-queue-recent"] });
    }
  };

  const statusColor: Record<string, string> = {
    pending: "bg-yellow-500/20 text-yellow-400",
    processing: "bg-blue-500/20 text-blue-400",
    done: "bg-green-500/20 text-green-400",
    failed: "bg-red-500/20 text-red-400",
    cancelled: "bg-muted text-muted-foreground",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Activity className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Fila de Análise</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(["pending", "processing", "done", "failed"] as const).map((s) => (
          <Card key={s}>
            <CardContent className="pt-4 pb-4">
              <div className="text-sm text-muted-foreground capitalize">{s}</div>
              <div className="text-2xl font-bold">{statsLoading ? "—" : stats?.[s] ?? 0}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Enqueue */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            Enfileirar Análises
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Campanha</Label>
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
          </div>
          <Button onClick={enqueueByCampaign} disabled={enqueuing || !campaignId}>
            {enqueuing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Enfileirar gravações sem métricas
          </Button>
        </CardContent>
      </Card>

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Ações</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={retryFailed}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retentar falhas
          </Button>
          <Button variant="destructive" onClick={cancelAll}>
            <Square className="h-4 w-4 mr-2" />
            Cancelar pendentes
          </Button>
          <Button variant="outline" onClick={clearCompleted}>
            <Trash2 className="h-4 w-4 mr-2" />
            Limpar concluídos
          </Button>
        </CardContent>
      </Card>

      {/* Recent jobs */}
      <Card>
        <CardHeader>
          <CardTitle>Jobs Recentes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {recentJobs?.map((job: any) => (
              <div key={job.id} className="flex items-center justify-between text-sm border-b border-border/50 py-2">
                <div className="flex items-center gap-3">
                  <Badge className={statusColor[job.status] || ""} variant="outline">
                    {job.status}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">
                    {job.recording_id?.slice(0, 8)}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {job.attempts > 0 && <span>tentativa {job.attempts}</span>}
                  {job.last_error && (
                    <span className="text-red-400 max-w-48 truncate" title={job.last_error}>
                      {job.last_error}
                    </span>
                  )}
                  <span>{new Date(job.created_at).toLocaleString("pt-BR")}</span>
                </div>
              </div>
            ))}
            {!recentJobs?.length && (
              <p className="text-muted-foreground text-sm">Nenhum job na fila</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
