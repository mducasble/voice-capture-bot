import { useState, useCallback, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Mic, CheckCircle2, XCircle, AlertTriangle, RotateCcw, Loader2, ChevronDown, ChevronUp, Play, Pause } from "lucide-react";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { toast } from "sonner";
import { useWavRecorder } from "@/hooks/useWavRecorder";
import KGenButton from "@/components/portal/KGenButton";
import { useTranslation } from "react-i18next";

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
  isPortal?: boolean;
}

const TEST_DURATION = 10;

/**
 * AudioTestFlow — diagnostic-only component.
 * Records a short audio sample, analyzes quality metrics via the backend,
 * and shows diagnostic guidance. No longer applies audio profile filters
 * to the recording pipeline (clean pipeline is used for all recordings).
 */
export const AudioTestFlow = ({
  participantId,
  participantName,
  roomId,
  stream,
  testStatus,
  testResults: initialResults,
  onTestComplete,
  isPortal = false,
}: AudioTestFlowProps) => {
  const dismissedKey = `audio_test_dismissed_${roomId}_${participantId}`;
  const wasDismissed = () => {
    try { return localStorage.getItem(dismissedKey) === "1"; } catch { return false; }
  };

  const [phase, setPhase] = useState<"idle" | "recording" | "analyzing" | "results">(
    initialResults && !wasDismissed() ? "results" : "idle"
  );
  const [countdown, setCountdown] = useState(TEST_DURATION);
  const [results, setResults] = useState<TestResults | null>(initialResults);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [showResultDetails, setShowResultDetails] = useState(initialResults && !wasDismissed());
  const [fromCache, setFromCache] = useState(false);
  const testBlobUrlRef = useRef<string | null>(null);
  const { t } = useTranslation("translation");

  // Test uses no profile (raw capture for accurate measurement)
  const wavRecorder = useWavRecorder({ sampleRate: 48000, channels: 1 });
  const audioPlayer = useAudioPlayer();

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
      toast.error(t("audioTest.micNotAvailable"));
      return;
    }
    setPhase("recording");
    setCountdown(TEST_DURATION);
    setResults(null);
    setFromCache(false);
    setShowResultDetails(true);
    await wavRecorder.startRecording(stream);
  }, [stream, wavRecorder]);

  const stopTest = useCallback(async () => {
    setPhase("analyzing");
    setAnalysisProgress(10);

    const wavBlob = await wavRecorder.stopRecording();
    if (!wavBlob || wavBlob.size === 0) {
      toast.error(t("audioTest.noAudioCaptured"));
      setPhase("idle");
      return;
    }

    setAnalysisProgress(30);

    // Store blob URL for playback
    if (testBlobUrlRef.current) URL.revokeObjectURL(testBlobUrlRef.current);
    const blobUrl = URL.createObjectURL(wavBlob);
    testBlobUrlRef.current = blobUrl;
    audioPlayer.load(blobUrl);

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
        toast.success(t("audioTest.testPassed"));
      } else {
        toast.warning(t("audioTest.testFailed"));
      }
    } catch (error) {
      console.error("Test error:", error);
      toast.error(t("audioTest.analysisError"));
      setPhase("idle");
    }
  }, [wavRecorder, participantId, roomId, onTestComplete, t]);

  const retryTest = () => {
    setPhase("idle");
    setResults(null);
    setCountdown(TEST_DURATION);
    audioPlayer.cleanup();
    if (testBlobUrlRef.current) {
      URL.revokeObjectURL(testBlobUrlRef.current);
      testBlobUrlRef.current = null;
    }
  };

  const dismissResults = () => {
    setShowResultDetails(false);
    setPhase("idle");
    try { localStorage.setItem(dismissedKey, "1"); } catch { /* */ }
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
    if (key === "mic_sr" || key === "device_sr") return `${(value / 1000).toFixed(1)}kHz`;
    if (key === "rms") return `${value.toFixed(1)} dBFS`;
    if (key === "snr") return `${value.toFixed(1)} dB`;
    if (key === "vqscore") return value.toFixed(2);
    return value.toFixed(2);
  };

  // Idle: show start button
  if (phase === "idle") {
    if (isPortal) {
      return (
        <div className="p-6 text-center space-y-4" style={{ border: "2px dashed var(--portal-border)", background: "var(--portal-input-bg)" }}>
          <p className="font-mono text-xs font-bold uppercase tracking-widest" style={{ color: "var(--portal-text)" }}>🎙️ {t("audioTest.title")}</p>
          <p className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
            {t("audioTest.idleDesc", { duration: TEST_DURATION })}
          </p>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider" style={{ background: "hsl(45 93% 47% / 0.15)", color: "hsl(45 93% 47%)", border: "1px solid hsl(45 93% 47% / 0.3)" }}>
            <AlertTriangle className="h-3 w-3" />
            {t("audioTest.idealRetestHint")}
          </span>
          <div className="flex justify-center">
            <KGenButton onClick={startTest} scrambleText={t("audioTest.startTest")} icon={<Mic className="h-4 w-4" />} />
          </div>
        </div>
      );
    }
    return (
      <Card className="border-dashed border-2 border-primary/30">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-base">🎙️ {t("audioTest.title")}</CardTitle>
          <CardDescription>
            {t("audioTest.idleDesc", { duration: TEST_DURATION })}
          </CardDescription>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider mx-auto" style={{ background: "hsl(45 93% 47% / 0.15)", color: "hsl(45 93% 47%)", border: "1px solid hsl(45 93% 47% / 0.3)" }}>
            <AlertTriangle className="h-3 w-3" />
            {t("audioTest.idealRetestHint")}
          </span>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button onClick={startTest} size="lg" className="gap-2">
            <Mic className="h-5 w-5" />
            {t("audioTest.startTest")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Recording
  if (phase === "recording") {
    const progress = ((TEST_DURATION - countdown) / TEST_DURATION) * 100;
    if (isPortal) {
      return (
        <div className="p-6 text-center space-y-4" style={{ border: "2px solid hsl(0 84% 60%)", background: "var(--portal-input-bg)" }}>
          <div className="flex items-center justify-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "hsl(0 84% 60%)" }} />
              <span className="relative inline-flex rounded-full h-3 w-3" style={{ background: "hsl(0 84% 60%)" }} />
            </span>
            <span className="font-mono text-xs font-bold uppercase tracking-widest" style={{ color: "var(--portal-text)" }}>{t("audioTest.recordingTest")}</span>
          </div>
          <p className="font-mono text-4xl font-black" style={{ color: "var(--portal-text)" }}>
            {Math.floor(countdown / 60)}:{(countdown % 60).toString().padStart(2, "0")}
          </p>
          <div className="w-full h-1" style={{ background: "var(--portal-border)" }}>
            <div className="h-full transition-all" style={{ width: `${progress}%`, background: "hsl(0 84% 60%)" }} />
          </div>
          <p className="font-mono text-[10px]" style={{ color: "var(--portal-text-muted)" }}>
            {t("audioTest.recordingDesc")}
          </p>
        </div>
      );
    }
    return (
      <Card className="border-2 border-red-500/50">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-base flex items-center justify-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
            </span>
            {t("audioTest.recordingTest")}
          </CardTitle>
          <CardDescription>{t("audioTest.recordingDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Progress value={progress} className="h-2" />
          <p className="text-center text-2xl font-mono font-bold text-foreground">
            {Math.floor(countdown / 60)}:{(countdown % 60).toString().padStart(2, "0")}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Analyzing
  if (phase === "analyzing") {
    if (isPortal) {
      return (
        <div className="p-6 text-center space-y-4" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-input-bg)" }}>
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--portal-accent)" }} />
            <span className="font-mono text-xs font-bold uppercase tracking-widest" style={{ color: "var(--portal-text)" }}>{t("audioTest.analyzing")}</span>
          </div>
          <p className="font-mono text-[10px]" style={{ color: "var(--portal-text-muted)" }}>{t("audioTest.analyzingDesc")}</p>
          <div className="w-full h-1" style={{ background: "var(--portal-border)" }}>
            <div className="h-full transition-all" style={{ width: `${analysisProgress}%`, background: "var(--portal-accent)" }} />
          </div>
        </div>
      );
    }
    return (
      <Card>
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-base flex items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            {t("audioTest.analyzing")}
          </CardTitle>
          <CardDescription>{t("audioTest.analyzingDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Progress value={analysisProgress} className="h-2" />
        </CardContent>
      </Card>
    );
  }

  // Results — diagnostic only (no profile configuration)
  if (phase === "results" && results) {
    const passed = results.overall_status === "passed";

    const Wrapper = isPortal ? "div" : Card;
    const wrapperProps = isPortal
      ? { className: "flex flex-col", style: { border: `2px solid ${passed ? "var(--portal-accent)" : "hsl(45 93% 47%)"}`, background: "var(--portal-input-bg)" } }
      : { className: `border-2 ${passed ? "border-green-500/50" : "border-yellow-500/50"}` };

    return (
      <Wrapper {...wrapperProps as any}>
        {isPortal ? (
          <div className="p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold uppercase tracking-widest" style={{ color: "var(--portal-text)" }}>
                  {t("audioTest.testResult")}
                </span>
                {fromCache && <span className="font-mono text-[10px]" style={{ color: "var(--portal-text-muted)" }}>{t("audioTest.previousSession")}</span>}
              </div>
              <span className="font-mono text-[10px] font-bold uppercase px-2 py-1" style={{ background: passed ? "var(--portal-accent)" : "hsl(45 93% 47%)", color: passed ? "var(--portal-accent-text)" : "hsl(168,28%,10%)" }}>
                {passed ? t("audioTest.passed") : t("audioTest.failed")}
              </span>
            </div>
            
            <div className="w-full h-px" style={{ background: "var(--portal-border)" }} />

            <div className="flex gap-2">
              {testBlobUrlRef.current && (
                <KGenButton variant="outline" size="sm" onClick={() => audioPlayer.toggle()} className="flex-1" scrambleText={audioPlayer.isPlaying ? t("audioTest.pause") : t("audioTest.listenTest")} />
              )}
              <KGenButton variant="outline" size="sm" onClick={retryTest} className="flex-1" scrambleText={t("audioTest.retryTest")} />
              <KGenButton variant="outline" size="sm" onClick={dismissResults} className="flex-1" scrambleText={t("audioTest.skipConfig")} />
            </div>

            <button 
              onClick={() => setShowResultDetails(v => !v)}
              className="font-mono text-[10px] text-center w-full uppercase flex justify-center items-center gap-1 mt-2 transition-colors hover:text-white"
              style={{ color: "var(--portal-text-muted)" }}
            >
              {showResultDetails ? t("audioTest.hideDetails") : t("audioTest.showDetails")}
              {showResultDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          </div>
        ) : (
          <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowResultDetails(v => !v)}>
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                {passed ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-yellow-500" />
                )}
                {t("audioTest.testResult")}
                {fromCache && (
                  <span className="text-xs font-normal text-muted-foreground">{t("audioTest.previousSession")}</span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <Badge variant={passed ? "default" : "destructive"}>
                  {passed ? `✅ ${t("audioTest.passed")}` : `❌ ${t("audioTest.failed")}`}
                </Badge>
                {showResultDetails ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>
            </CardTitle>
          </CardHeader>
        )}

        {showResultDetails && (
          <div className={isPortal ? "p-4 pt-0 space-y-4" : "p-6 pt-0 space-y-4"}>
            {/* Metrics Table */}
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    {Object.entries(results.metrics).map(([key, m]) => (
                      <TableHead key={key} className={`text-center text-xs py-1.5 px-2 ${getHeaderBg(m.status)}`}>
                        {t(`audioTest.metrics.${key}.label`, { defaultValue: m.label })}
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
                <p className="text-sm font-medium text-foreground">{t("audioTest.guidelines")}</p>
                {results.issues.map((issue, i) => (
                  <div key={i} className={`p-3 rounded-lg border text-sm ${getStatusColor(issue.status)}`}>
                    <div className="font-medium mb-1 flex items-center gap-1.5">
                      {issue.status === "bad" ? (
                        <XCircle className="h-4 w-4 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                      )}
                      {t(`audioTest.issues.${issue.metric}.label`, { defaultValue: issue.label })}
                    </div>
                    <p className="text-xs opacity-90">
                      {issue.metric === "rms" && results.metrics.rms?.value != null && results.metrics.rms.value > -16
                        ? t(`audioTest.issues.rms.guidanceHigh`, { defaultValue: issue.guidance })
                        : t(`audioTest.issues.${issue.metric}.guidance`, { defaultValue: issue.guidance })}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Actions for non-portal inside details */}
            {!isPortal && (
              <div className="flex justify-center gap-3 mt-4">
                {testBlobUrlRef.current && (
                  <Button variant="outline" size="sm" onClick={() => audioPlayer.toggle()} className="gap-1.5">
                    {audioPlayer.isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    {audioPlayer.isPlaying ? t("audioTest.pause") : t("audioTest.listenTest")}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={retryTest} className="gap-1.5">
                  <RotateCcw className="h-4 w-4" />
                  {t("audioTest.retryTest")}
                </Button>
                <Button variant="outline" size="sm" onClick={dismissResults} className="gap-1.5">
                  {t("audioTest.skipConfig")}
                </Button>
              </div>
            )}
          </div>
        )}
        
        {/* Always show retry button for non-portal when collapsed */}
        {!isPortal && !showResultDetails && (
          <div className="p-6 pt-0 flex justify-center gap-3">
            <Button variant="outline" size="sm" onClick={retryTest} className="gap-1.5">
              <RotateCcw className="h-4 w-4" />
              {t("audioTest.retryTest")}
            </Button>
          </div>
        )}
      </Wrapper>
    );
  }

  return null;
};
