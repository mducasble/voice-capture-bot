import { useState, useCallback, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Mic, CheckCircle2, XCircle, AlertTriangle, RotateCcw, Loader2, Settings2, ChevronDown, ChevronUp, Play, Pause } from "lucide-react";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { toast } from "sonner";
import { useWavRecorder } from "@/hooks/useWavRecorder";
import { computeAudioProfile, getProfileDescriptions, DEFAULT_PROFILE, type AudioProfile, type TestMetrics } from "@/lib/audioProfile";
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
  onProfileRecommended?: (profile: AudioProfile) => void;
  currentProfile?: AudioProfile | null;
  isPortal?: boolean;
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
  onProfileRecommended,
  currentProfile,
  isPortal = false,
}: AudioTestFlowProps) => {
  const [phase, setPhase] = useState<"idle" | "recording" | "analyzing" | "results">(
    initialResults ? "results" : "idle"
  );
  const [countdown, setCountdown] = useState(TEST_DURATION);
  const [results, setResults] = useState<TestResults | null>(initialResults);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [showProfileDetails, setShowProfileDetails] = useState(false);
  const [showResultDetails, setShowResultDetails] = useState(!false); // expanded by default for fresh tests
  const [fromCache, setFromCache] = useState(false);
  const [recommendedProfile, setRecommendedProfile] = useState<AudioProfile | null>(null);
  const [editedProfile, setEditedProfile] = useState<AudioProfile | null>(null);
  const testBlobUrlRef = useRef<string | null>(null);
  const { t } = useTranslation("translation");

  // Test uses no profile (raw capture for accurate measurement)
  const wavRecorder = useWavRecorder({ sampleRate: 48000, channels: 1 });
  const audioPlayer = useAudioPlayer();

  const STORAGE_KEY = `audio_test_profile`;

  // Restore cached results from localStorage on mount
  useEffect(() => {
    if (initialResults) return; // server data takes priority
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as { results: TestResults; profile: AudioProfile };
        setResults(parsed.results);
        setRecommendedProfile(parsed.profile);
        setEditedProfile(parsed.profile);
        setPhase("results");
        setFromCache(true);
        setShowResultDetails(false); // collapsed when from cache
        // Auto-apply cached profile
        if (onProfileRecommended) onProfileRecommended(parsed.profile);
      }
    } catch { /* ignore corrupt data */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update results when props change (realtime)
  useEffect(() => {
    if (initialResults) {
      setResults(initialResults);
      if (phase !== "results") setPhase("results");
      // Compute profile from initial results
      const metrics = extractMetrics(initialResults);
      const profile = computeAudioProfile(metrics);
      setRecommendedProfile(profile);
      setEditedProfile(profile);
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

  function extractMetrics(res: TestResults): TestMetrics {
    return {
      snr: res.metrics.snr?.value ?? null,
      rms: res.metrics.rms?.value ?? null,
      srmr: res.metrics.srmr?.value ?? null,
      wvmos: res.metrics.wvmos?.value ?? null,
      utmos: res.metrics.utmos?.value ?? null,
      sigmos_ovrl: res.metrics.sigmos_ovrl?.value ?? null,
      sigmos_disc: res.metrics.sigmos_disc?.value ?? null,
      sigmos_reverb: res.metrics.sigmos_reverb?.value ?? null,
      vqscore: res.metrics.vqscore?.value ?? null,
      mic_sr: res.metrics.mic_sr?.value ?? null,
    };
  }

  const startTest = useCallback(async () => {
    if (!stream) {
      toast.error(t("audioTest.micNotAvailable"));
      return;
    }
    setPhase("recording");
    setCountdown(TEST_DURATION);
    setResults(null);
    setRecommendedProfile(null);
    setEditedProfile(null);
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

      // Compute recommended profile
      const metrics = extractMetrics(data);
      const profile = computeAudioProfile(metrics);
      setRecommendedProfile(profile);
      setEditedProfile(profile);

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
    setRecommendedProfile(null);
    setEditedProfile(null);
    audioPlayer.cleanup();
    if (testBlobUrlRef.current) {
      URL.revokeObjectURL(testBlobUrlRef.current);
      testBlobUrlRef.current = null;
    }
  };

  const applyProfile = () => {
    if (editedProfile && onProfileRecommended) {
      onProfileRecommended(editedProfile);
      // Persist to localStorage
      if (results) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ results, profile: editedProfile }));
        } catch { /* quota exceeded */ }
      }
      toast.success("Configuração de áudio aplicada! 🎛️");
    }
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
          <p className="font-mono text-xs font-bold uppercase tracking-widest" style={{ color: "var(--portal-text)" }}>🎙️ Teste de Áudio</p>
          <p className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
            Grave {TEST_DURATION}s falando normalmente para avaliar a qualidade do seu setup
          </p>
          <div className="flex justify-center">
            <KGenButton onClick={startTest} scrambleText="INICIAR TESTE" icon={<Mic className="h-4 w-4" />} />
          </div>
        </div>
      );
    }
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
    if (isPortal) {
      return (
        <div className="p-6 text-center space-y-4" style={{ border: "2px solid hsl(0 84% 60%)", background: "var(--portal-input-bg)" }}>
          <div className="flex items-center justify-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "hsl(0 84% 60%)" }} />
              <span className="relative inline-flex rounded-full h-3 w-3" style={{ background: "hsl(0 84% 60%)" }} />
            </span>
            <span className="font-mono text-xs font-bold uppercase tracking-widest" style={{ color: "var(--portal-text)" }}>Gravando Teste...</span>
          </div>
          <p className="font-mono text-4xl font-black" style={{ color: "var(--portal-text)" }}>
            {Math.floor(countdown / 60)}:{(countdown % 60).toString().padStart(2, "0")}
          </p>
          <div className="w-full h-1" style={{ background: "var(--portal-border)" }}>
            <div className="h-full transition-all" style={{ width: `${progress}%`, background: "hsl(0 84% 60%)" }} />
          </div>
          <p className="font-mono text-[10px]" style={{ color: "var(--portal-text-muted)" }}>
            Fale como se estivesse gravando normalmente. Evite pausas muito longas.
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
    if (isPortal) {
      return (
        <div className="p-6 text-center space-y-4" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-input-bg)" }}>
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--portal-accent)" }} />
            <span className="font-mono text-xs font-bold uppercase tracking-widest" style={{ color: "var(--portal-text)" }}>Analisando áudio...</span>
          </div>
          <p className="font-mono text-[10px]" style={{ color: "var(--portal-text-muted)" }}>Calculando métricas de qualidade. Isso pode levar até 30s.</p>
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
    const profileApplied = currentProfile != null && editedProfile != null;
    const descriptions = editedProfile ? getProfileDescriptions(editedProfile) : [];

    const Wrapper = isPortal ? "div" : Card;
    const wrapperProps = isPortal
      ? { className: "flex flex-col", style: { border: `2px solid ${passed ? "var(--portal-accent)" : "hsl(45 93% 47%)"}`, background: "var(--portal-input-bg)" } }
      : { className: `border-2 ${passed ? "border-green-500/50" : "border-yellow-500/50"}` };

    return (
      <Wrapper {...wrapperProps as any}>
        {isPortal ? (
          <div className="p-4 flex flex-col gap-4">
            {/* Header row: Left Title, Right Badge */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold uppercase tracking-widest" style={{ color: "var(--portal-text)" }}>
                  Resultado do Teste
                </span>
                {fromCache && <span className="font-mono text-[10px]" style={{ color: "var(--portal-text-muted)" }}>(sessão anterior)</span>}
              </div>
              <span className="font-mono text-[10px] font-bold uppercase px-2 py-1" style={{ background: passed ? "var(--portal-accent)" : "hsl(45 93% 47%)", color: passed ? "var(--portal-accent-text)" : "hsl(168,28%,10%)" }}>
                {passed ? "APROVADO" : "REPROVADO"}
              </span>
            </div>
            
            {/* Divider line */}
            <div className="w-full h-px" style={{ background: "var(--portal-border)" }} />

            {/* Actions row */}
            <div className="flex gap-2">
              {testBlobUrlRef.current && (
                <KGenButton variant="outline" size="sm" onClick={() => audioPlayer.toggle()} className="flex-1" scrambleText={audioPlayer.isPlaying ? "PAUSAR" : "OUVIR TESTE"} />
              )}
              <KGenButton variant="outline" size="sm" onClick={retryTest} className="flex-1" scrambleText="REFAZER TESTE" />
            </div>

            {/* Toggle details */}
            <button 
              onClick={() => setShowResultDetails(v => !v)}
              className="font-mono text-[10px] text-center w-full uppercase flex justify-center items-center gap-1 mt-2 transition-colors hover:text-white"
              style={{ color: "var(--portal-text-muted)" }}
            >
              {showResultDetails ? "Ocultar detalhes" : "Ver detalhes métricas"}
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
                Resultado do Teste
                {fromCache && (
                  <span className="text-xs font-normal text-muted-foreground">(sessão anterior)</span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <Badge variant={passed ? "default" : "destructive"}>
                  {passed ? "Aprovado ✅" : "Reprovado ❌"}
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

            {/* Recommended Audio Profile */}
            {editedProfile && (
              <div className="space-y-3 p-3 rounded-lg border border-primary/30 bg-primary/5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Settings2 className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium text-foreground">Configuração Recomendada</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => setShowProfileDetails(!showProfileDetails)}
                  >
                    {showProfileDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </div>

                {/* Summary badges */}
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="text-xs">
                    Ganho: {editedProfile.gain.toFixed(1)}x
                  </Badge>
                  {editedProfile.highpassFreq > 0 && (
                    <Badge variant="outline" className="text-xs">
                      HP: {editedProfile.highpassFreq}Hz
                    </Badge>
                  )}
                  {editedProfile.lowpassFreq > 0 && (
                    <Badge variant="outline" className="text-xs">
                      LP: {(editedProfile.lowpassFreq / 1000).toFixed(0)}kHz
                    </Badge>
                  )}
                  {editedProfile.enableRnnoise && (
                    <Badge variant="outline" className="text-xs border-blue-500/50 text-blue-400">
                      RNNoise
                    </Badge>
                  )}
                  {editedProfile.enableKoala && (
                    <Badge variant="outline" className="text-xs border-cyan-500/50 text-cyan-400">
                      Koala
                    </Badge>
                  )}
                  {editedProfile.enableNoiseGate && (
                    <Badge variant="outline" className="text-xs border-orange-500/50 text-orange-400">
                      Noise Gate
                    </Badge>
                  )}
                  {editedProfile.enableEchoCancellation && (
                    <Badge variant="outline" className="text-xs border-purple-500/50 text-purple-400">
                      Echo
                    </Badge>
                  )}
                  {editedProfile.enableNoiseSuppression && (
                    <Badge variant="outline" className="text-xs border-purple-500/50 text-purple-400">
                      NoiseSup
                    </Badge>
                  )}
                  {editedProfile.enableAutoGainControl && (
                    <Badge variant="outline" className="text-xs border-purple-500/50 text-purple-400">
                      AGC
                    </Badge>
                  )}
                </div>

                {/* Editable details */}
                {showProfileDetails && (
                  <div className="space-y-3 pt-2 border-t border-border/50">
                    {/* Gain slider */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Ganho</span>
                        <span className="font-mono">{editedProfile.gain.toFixed(2)}x</span>
                      </div>
                      <Slider
                        value={[editedProfile.gain]}
                        min={0.5}
                        max={20}
                        step={0.1}
                        onValueChange={([val]) => setEditedProfile(p => p ? { ...p, gain: val } : p)}
                      />
                    </div>

                    {/* Highpass slider */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">High-pass</span>
                        <span className="font-mono">{editedProfile.highpassFreq > 0 ? `${editedProfile.highpassFreq} Hz` : "Off"}</span>
                      </div>
                      <Slider
                        value={[editedProfile.highpassFreq]}
                        min={0}
                        max={200}
                        step={10}
                        onValueChange={([val]) => setEditedProfile(p => p ? { ...p, highpassFreq: val } : p)}
                      />
                    </div>

                    {/* Lowpass slider */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Low-pass</span>
                        <span className="font-mono">{editedProfile.lowpassFreq > 0 ? `${(editedProfile.lowpassFreq / 1000).toFixed(0)} kHz` : "Off"}</span>
                      </div>
                      <Slider
                        value={[editedProfile.lowpassFreq]}
                        min={0}
                        max={22000}
                        step={1000}
                        onValueChange={([val]) => setEditedProfile(p => p ? { ...p, lowpassFreq: val } : p)}
                      />
                    </div>

                    {/* Toggles */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xs text-muted-foreground">RNNoise</span>
                        <Switch
                          checked={editedProfile.enableRnnoise}
                          onCheckedChange={(v) => setEditedProfile(p => p ? { ...p, enableRnnoise: v, ...(v ? { enableKoala: false } : {}) } : p)}
                        />
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xs text-muted-foreground">Koala</span>
                        <Switch
                          checked={editedProfile.enableKoala}
                          onCheckedChange={(v) => setEditedProfile(p => p ? { ...p, enableKoala: v, ...(v ? { enableRnnoise: false } : {}) } : p)}
                        />
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xs text-muted-foreground">Noise Gate</span>
                        <Switch
                          checked={editedProfile.enableNoiseGate}
                          onCheckedChange={(v) => setEditedProfile(p => p ? { ...p, enableNoiseGate: v } : p)}
                        />
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xs text-muted-foreground">Echo</span>
                        <Switch
                          checked={editedProfile.enableEchoCancellation}
                          onCheckedChange={(v) => setEditedProfile(p => p ? { ...p, enableEchoCancellation: v } : p)}
                        />
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xs text-muted-foreground">NoiseSup</span>
                        <Switch
                          checked={editedProfile.enableNoiseSuppression}
                          onCheckedChange={(v) => setEditedProfile(p => p ? { ...p, enableNoiseSuppression: v } : p)}
                        />
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xs text-muted-foreground">AGC</span>
                        <Switch
                          checked={editedProfile.enableAutoGainControl}
                          onCheckedChange={(v) => setEditedProfile(p => p ? { ...p, enableAutoGainControl: v } : p)}
                        />
                      </div>
                    </div>

                    {/* Descriptions */}
                    <div className="space-y-1.5">
                      {descriptions.map((d, i) => (
                        <div key={i} className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{d.label}:</span> {d.detail}
                        </div>
                      ))}
                    </div>

                    {/* Reset to recommended */}
                    {recommendedProfile && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs"
                        onClick={() => setEditedProfile(recommendedProfile)}
                      >
                        Restaurar recomendação original
                      </Button>
                    )}
                  </div>
                )}

                {/* Apply button */}
                <div className="flex gap-2 mt-4">
                  {isPortal ? (
                    <KGenButton
                      size="sm"
                      className="flex-1"
                      onClick={applyProfile}
                      scrambleText={profileApplied ? "ATUALIZAR CONFIGURAÇÃO" : "APLICAR CONFIGURAÇÃO"}
                      icon={<Settings2 className="h-4 w-4" />}
                    />
                  ) : (
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={applyProfile}
                    >
                      <Settings2 className="h-4 w-4 mr-1.5" />
                      {profileApplied ? "Atualizar Configuração" : "Aplicar Configuração"}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Actions for non-portal inside details */}
            {!isPortal && (
              <div className="flex justify-center gap-3 mt-4">
                {testBlobUrlRef.current && (
                  <Button variant="outline" size="sm" onClick={() => audioPlayer.toggle()} className="gap-1.5">
                    {audioPlayer.isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    {audioPlayer.isPlaying ? "Pausar" : "Ouvir Teste"}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={retryTest} className="gap-1.5">
                  <RotateCcw className="h-4 w-4" />
                  Refazer Teste
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
              Refazer Teste
            </Button>
          </div>
        )}
      </Wrapper>
    );
  }

  return null;
};
