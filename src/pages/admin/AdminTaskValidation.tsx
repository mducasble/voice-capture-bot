import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CampaignSelector } from "@/components/CampaignSelector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { Clock, Settings2, History, Save, Plus, CheckCircle2, XCircle, Timer } from "lucide-react";
import { format } from "date-fns";

const AVAILABLE_ACTIONS = [
  { id: "play", label: "Play" },
  { id: "pause", label: "Pause" },
  { id: "seek", label: "Seek (mover barra)" },
  { id: "enhance", label: "Enhance" },
  { id: "reanalyze", label: "Reanalisar" },
  { id: "zoom_waveform", label: "Zoom waveform" },
  { id: "change_speed", label: "Alterar velocidade" },
  { id: "volume_change", label: "Alterar volume" },
  { id: "loop_section", label: "Loop de trecho" },
];

interface TaskSetConfig {
  id: string;
  task_set_id: string;
  campaign_id: string;
  content_type: string;
  time_limit_seconds: number;
  tracked_actions: string[];
  is_active: boolean;
}

interface TaskSet {
  id: string;
  task_set_id: string;
  task_type: string;
  enabled: boolean;
  instructions_title: string | null;
}

interface TaskLog {
  id: string;
  user_id: string;
  submission_id: string;
  submission_type: string;
  status: string;
  actions_log: any[];
  time_spent_seconds: number;
  started_at: string;
  completed_at: string | null;
  result: any;
}

export default function AdminTaskValidation() {
  const [campaignId, setCampaignId] = useState("");
  const [historyFilter, setHistoryFilter] = useState<"all" | "completed" | "timeout">("all");
  const queryClient = useQueryClient();

  // Fetch task sets for selected campaign
  const { data: taskSets } = useQuery({
    queryKey: ["task-sets", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_task_sets")
        .select("id, task_set_id, task_type, enabled, instructions_title")
        .eq("campaign_id", campaignId)
        .order("created_at");
      if (error) throw error;
      return data as TaskSet[];
    },
    enabled: !!campaignId,
  });

  // Fetch existing configs for this campaign
  const { data: configs } = useQuery({
    queryKey: ["validation-task-configs", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("validation_task_config")
        .select("*")
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return data as TaskSetConfig[];
    },
    enabled: !!campaignId,
  });

  // Fetch task logs for this campaign
  const { data: taskLogs } = useQuery({
    queryKey: ["validation-task-logs", campaignId, historyFilter],
    queryFn: async () => {
      let query = supabase
        .from("validation_task_log")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (historyFilter === "completed") query = query.eq("status", "completed");
      if (historyFilter === "timeout") query = query.eq("status", "timeout");

      const { data, error } = await query;
      if (error) throw error;
      return data as TaskLog[];
    },
    enabled: !!campaignId,
  });

  // Get config for a specific task_set
  const getConfigForTaskSet = (tsId: string) =>
    configs?.find((c) => c.task_set_id === tsId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Validação de Tarefas</h1>
        <p className="text-muted-foreground">
          Configure o tempo limite e as ações rastreadas por task set de cada campanha.
        </p>
      </div>

      <CampaignSelector value={campaignId} onChange={setCampaignId} className="max-w-md" />

      {campaignId && taskSets && (
        <>
          {/* Config cards per task set */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Settings2 className="h-5 w-5" />
              Configuração por Task Set
            </h2>

            {taskSets.length === 0 && (
              <p className="text-muted-foreground text-sm">
                Nenhum task set encontrado para esta campanha.
              </p>
            )}

            {taskSets.map((ts) => (
              <TaskSetConfigCard
                key={ts.id}
                taskSet={ts}
                campaignId={campaignId}
                existing={getConfigForTaskSet(ts.id)}
                onSaved={() =>
                  queryClient.invalidateQueries({
                    queryKey: ["validation-task-configs", campaignId],
                  })
                }
              />
            ))}
          </div>

          {/* History */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <History className="h-5 w-5" />
                Histórico de Validações
              </h2>
              <Select
                value={historyFilter}
                onValueChange={(v) => setHistoryFilter(v as any)}
              >
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="completed">Finalizados</SelectItem>
                  <SelectItem value="timeout">Tempo esgotado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Usuário</TableHead>
                      <TableHead>Conteúdo</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Tempo gasto</TableHead>
                      <TableHead>Ações</TableHead>
                      <TableHead>Início</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!taskLogs || taskLogs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          Nenhum registro encontrado.
                        </TableCell>
                      </TableRow>
                    ) : (
                      taskLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="font-mono text-xs">
                            {log.user_id.slice(0, 8)}…
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{log.submission_type}</Badge>
                            <span className="ml-2 font-mono text-xs">
                              {log.submission_id.slice(0, 8)}…
                            </span>
                          </TableCell>
                          <TableCell>
                            {log.status === "completed" ? (
                              <Badge className="bg-emerald-600 text-white">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Finalizado
                              </Badge>
                            ) : log.status === "timeout" ? (
                              <Badge variant="destructive">
                                <XCircle className="h-3 w-3 mr-1" />
                                Tempo esgotado
                              </Badge>
                            ) : (
                              <Badge variant="secondary">
                                <Timer className="h-3 w-3 mr-1" />
                                Em andamento
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {formatSeconds(log.time_spent_seconds)}
                          </TableCell>
                          <TableCell>
                            {Array.isArray(log.actions_log)
                              ? log.actions_log.length
                              : 0}{" "}
                            eventos
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {format(new Date(log.started_at), "dd/MM HH:mm")}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function formatSeconds(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}

// ---- Config Card per Task Set ----

function TaskSetConfigCard({
  taskSet,
  campaignId,
  existing,
  onSaved,
}: {
  taskSet: TaskSet;
  campaignId: string;
  existing?: TaskSetConfig;
  onSaved: () => void;
}) {
  const [timeLimitMin, setTimeLimitMin] = useState(
    existing ? Math.round(existing.time_limit_seconds / 60) : 5
  );
  const [trackedActions, setTrackedActions] = useState<string[]>(
    existing?.tracked_actions ?? ["play", "pause", "seek", "enhance", "reanalyze"]
  );
  const [isActive, setIsActive] = useState(existing?.is_active ?? true);

  const upsert = useMutation({
    mutationFn: async () => {
      const payload = {
        task_set_id: taskSet.id,
        campaign_id: campaignId,
        content_type: "audio",
        time_limit_seconds: timeLimitMin * 60,
        tracked_actions: trackedActions,
        is_active: isActive,
      };

      if (existing) {
        const { error } = await supabase
          .from("validation_task_config")
          .update(payload)
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("validation_task_config")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: "Configuração salva" });
      onSaved();
    },
    onError: (e: any) => {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    },
  });

  const toggleAction = (action: string) => {
    setTrackedActions((prev) =>
      prev.includes(action) ? prev.filter((a) => a !== action) : [...prev, action]
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            {taskSet.instructions_title || taskSet.task_set_id}
            <Badge variant="outline" className="ml-2">
              {taskSet.task_type}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Label htmlFor={`active-${taskSet.id}`} className="text-sm text-muted-foreground">
              Ativo
            </Label>
            <Switch
              id={`active-${taskSet.id}`}
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Time limit */}
        <div className="flex items-center gap-3">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <Label className="whitespace-nowrap">Tempo limite</Label>
          <Input
            type="number"
            min={1}
            max={60}
            value={timeLimitMin}
            onChange={(e) => setTimeLimitMin(Number(e.target.value))}
            className="w-20"
          />
          <span className="text-sm text-muted-foreground">minutos</span>
        </div>

        {/* Tracked actions */}
        <div className="space-y-2">
          <Label>Ações rastreadas</Label>
          <div className="grid grid-cols-3 gap-2">
            {AVAILABLE_ACTIONS.map((action) => (
              <label
                key={action.id}
                className="flex items-center gap-2 text-sm cursor-pointer"
              >
                <Checkbox
                  checked={trackedActions.includes(action.id)}
                  onCheckedChange={() => toggleAction(action.id)}
                />
                {action.label}
              </label>
            ))}
          </div>
        </div>

        <Button onClick={() => upsert.mutate()} disabled={upsert.isPending} size="sm">
          <Save className="h-4 w-4 mr-1" />
          {existing ? "Atualizar" : "Criar"} configuração
        </Button>
      </CardContent>
    </Card>
  );
}
