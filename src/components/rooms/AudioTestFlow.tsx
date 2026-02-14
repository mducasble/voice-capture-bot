import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Mic, CheckCircle2, XCircle, AlertTriangle, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useWavRecorder } from "@/hooks/useWavRecorder";

interface MetricResult {
  value: number | null;
  status: string;
  label: string;
}

interface TestIssue {
  metric: string;
  label: string;
  status: string;
  guidance: string;
}

interface TestResults {
  overall_status: "passed" | "failed";
  metrics: Record<string, MetricResult>;
  issues: TestIssue[];
  tested_at: string;
}

interface AudioTestFlowProps {
  participantId: string;
  participantName: string;
  roomId: string;
  stream: MediaStream | null;
  testStatus: string;
  testResults: TestResults | null;
  onTestComplete: () => void;
}

const TEST_DURATION = 10;

export const AudioTestFlow = ({
  participantId,
  participantName,
  roomId,
  stream,
  testStatus,
  testResults: initialResults,
  onTestComplete,
}: AudioTestFlowProps) => {
  const [phase, setPhase] = useState<"idle" | "recording" | "analyzing" | "results">(
    initialResults ? "results" : "idle"
  );
  const [countdown, setCountdown] = useState(TEST_DURATION);
  const [results, setResults] = useState<TestResults | null>(initialResults);
  const [analysisProgress, setAnalysisProgress] = useState(0);

  const wavRecorder = useWavRecorder({ sampleRate: 48000, channels: 1 });

  // Update results when props change (realtime)
  useEffect(() => {
    if (initialResults) {
      setResults(initialResults);
      if (phase !== "results") setPhase("results");
    }
  }, [initialResults]);

  // Countdown timer during recording
  useEffect(() => {
    if (phase !== "recording") return;
    if (countdown <= 0) {
      stopTest();
      return;
    }
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, countdown]);

  const startTest = useCallback(async () => {
    if (!stream) {
      toast.error("Microfone não disponível");
      return;
    }
    setPhase("recording");
    setCountdown(TEST_DURATION);
    setResults(null);
    await wavRecorder.startRecording(stream);
  }, [stream, wavRecorder]);

  const stopTest = useCallback(async () => {
    setPhase("analyzing");
    setAnalysisProgress(10);

    const wavBlob = await wavRecorder.stopRecording();
    if (!wavBlob || wavBlob.size === 0) {
      toast.error("Nenhum áudio capturado");
      setPhase("idle");
      return;
    }

    setAnalysisProgress(30);

    try {
      const formData = new FormData();
      formData.append("audio", wavBlob, "test.wav");
      formData.append("participant_id", participantId);
      formData.append("room_id", roomId);

      setAnalysisProgress(50);

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/test-room-audio`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: formData,
        }
      );

      setAnalysisProgress(80);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText);
      }

      const data: TestResults = await response.json();
      setResults(data);
      setAnalysisProgress(100);
      setPhase("results");
      onTestComplete();

      if (data.overall_status === "passed") {
        toast.success("Teste de áudio aprovado! ✅");
      } else {
        toast.warning("Teste de áudio com problemas. Veja as orientações abaixo.");
      }
    } catch (error) {
      console.error("Test error:", error);
      toast.error("Erro ao analisar áudio de teste");
      setPhase("idle");
    }
  }, [wavRecorder, participantId, roomId, onTestComplete]);

  const retryTest = () => {
    setPhase("idle");
    setResults(null);
    setCountdown(TEST_DURATION);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "good": return "bg-green-500/20 text-green-400 border-green-500/30";
      case "fair": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "bad": return "bg-red-500/20 text-red-400 border-red-500/30";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getHeaderBg = (status: string) => {
    switch (status) {
      case "good": return "bg-green-500/15 text-green-300";
      case "fair": return "bg-yellow-500/15 text-yellow-300";
      case "bad": return "bg-red-500/15 text-red-300";
      default: return "";
    }
  };

  const formatValue = (key: string, value: number | null) => {
    if (value === null) return "—";
    if (key === "mic_sr") return `${(value / 1000).toFixed(1)}kHz`;
    if (key === "rms") return `${value.toFixed(1)} dBFS`;
    if (key === "snr") return `${value.toFixed(1)} dB`;
    if (key === "vqscore") return value.toFixed(0);
    return value.toFixed(2);
  };

  // Idle: show start button
  if (phase === "idle") {
    return (
      <Card className="border-dashed border-2 border-primary/30">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-base">🎙️ Teste de Áudio</CardTitle>
          <CardDescription>
            Grave {TEST_DURATION}s falando normalmente para avaliar a qualidade do seu setup
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button onClick={startTest} size="lg" className="gap-2">
            <Mic className="h-5 w-5" />
            Iniciar Teste
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Recording
  if (phase === "recording") {
    const progress = ((TEST_DURATION - countdown) / TEST_DURATION) * 100;
    return (
      <Card className="border-2 border-red-500/50">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-base flex items-center justify-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
            </span>
            Gravando Teste...
          </CardTitle>
          <CardDescription>Fale normalmente por {countdown}s</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Progress value={progress} className="h-2" />
          <p className="text-center text-2xl font-mono font-bold text-foreground">
            {Math.floor(countdown / 60)}:{(countdown % 60).toString().padStart(2, "0")}
          </p>
          <p className="text-center text-xs text-muted-foreground">
            Fale como se estivesse gravando normalmente. Evite pausas muito longas.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Analyzing
  if (phase === "analyzing") {
    return (
      <Card>
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-base flex items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Analisando áudio...
          </CardTitle>
          <CardDescription>Calculando métricas de qualidade. Isso pode levar até 30s.</CardDescription>
        </CardHeader>
        <CardContent>
          <Progress value={analysisProgress} className="h-2" />
        </CardContent>
      </Card>
    );
  }

  // Results
  if (phase === "results" && results) {
    const passed = results.overall_status === "passed";
    return (
      <Card className={`border-2 ${passed ? "border-green-500/50" : "border-yellow-500/50"}`}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              {passed ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
              )}
              Resultado do Teste
            </span>
            <Badge variant={passed ? "default" : "destructive"}>
              {passed ? "Aprovado ✅" : "Reprovado ❌"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Metrics Table */}
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  {Object.entries(results.metrics).map(([key, m]) => (
                    <TableHead key={key} className={`text-center text-xs py-1.5 px-2 ${getHeaderBg(m.status)}`}>
                      {m.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  {Object.entries(results.metrics).map(([key, m]) => (
                    <TableCell key={key} className="text-center text-xs py-1.5 px-2 font-mono">
                      {formatValue(key, m.value)}
                    </TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {/* Issues & Guidance */}
          {results.issues.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Orientações para melhorar:</p>
              {results.issues.map((issue, i) => (
                <div key={i} className={`p-3 rounded-lg border text-sm ${getStatusColor(issue.status)}`}>
                  <div className="font-medium mb-1 flex items-center gap-1.5">
                    {issue.status === "bad" ? (
                      <XCircle className="h-4 w-4 shrink-0" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                    )}
                    {issue.label}
                  </div>
                  <p className="text-xs opacity-90">{issue.guidance}</p>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-center gap-3">
            <Button variant="outline" size="sm" onClick={retryTest} className="gap-1.5">
              <RotateCcw className="h-4 w-4" />
              Refazer Teste
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
};
