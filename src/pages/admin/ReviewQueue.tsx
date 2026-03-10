import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Clock, FileAudio, Users, Play, Pause, ChevronDown,
  CheckCircle2, XCircle, User, BarChart3, ShieldCheck, ShieldX, AlertTriangle, Hourglass,
} from "lucide-react";
import { useState, useRef, useCallback, useMemo } from "react";
import { toast } from "sonner";

// ---- types ----

interface Recording {
  id: string;
  filename: string;
  duration_seconds: number | null;
  recording_type: string | null;
  session_id: string | null;
  created_at: string;
  discord_username: string | null;
  file_url: string | null;
  status: string | null;
  campaign_id: string | null;
  user_id: string | null;
  quality_status: string | null;
  validation_status: string | null;
  quality_rejection_reason: string | null;
  validation_rejection_reason: string | null;
  snr_db: number | null;
  sample_rate: number | null;
  bit_depth: number | null;
  channels: number | null;
  format: string | null;
  file_size_bytes: number | null;
  transcription_status: string | null;
  metadata: {
    rms_level_db?: number;
    effective_bandwidth_hz?: number;
    srmr?: number;
    sigmos_sig?: number;
    sigmos_bak?: number;
    sigmos_ovrl?: number;
    wvmos?: number;
    analysis_mode?: string;
  } | null;
}

interface CampaignInfo {
  id: string;
  name: string;
  description: string | null;
  campaign_type: string | null;
}

interface ProfileInfo {
  id: string;
  full_name: string | null;
  email_contact: string | null;
}

interface RoomInfo {
  id: string;
  session_id: string | null;
  topic: string | null;
  creator_name: string;
}

interface SessionGroup {
  sessionId: string;
  recordings: Recording[];
  mixed: Recording | undefined;
  individuals: Recording[];
  createdAt: string;
  topic: string | null;
  creatorName: string | null;
}

interface HostGroup {
  hostName: string;
  sessions: SessionGroup[];
  totalRecordings: number;
  pendingSessions: number;
}

const REJECTION_REASONS = [
  "Número insuficiente de participantes",
  "Áudio abaixo do padrão mínimo de qualidade",
  "Desvio do tema superior a 20%",
  "Participante infringiu as regras de produção ou envio de material",
  "Duração menor que o tempo previsto",
  "Material inconsistente (Upload de arquivos de duração diferentes)",
  "Um dos participantes já ultrapassou a cota máxima dessa campanha",
];

// ---- helpers ----

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}min ${Math.round(seconds % 60)}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}min`;
}

function snrColor(snr: number | null) {
  if (snr == null) return "hsl(0 0% 50%)";
  if (snr >= 25) return "hsl(120 60% 45%)";
  if (snr >= 15) return "hsl(40 80% 50%)";
  return "hsl(0 70% 50%)";
}

function metricColor(value: number | null | undefined, good: number, warn: number) {
  if (value == null) return "hsl(0 0% 50%)";
  if (value >= good) return "hsl(120 60% 45%)";
  if (value >= warn) return "hsl(40 80% 50%)";
  return "hsl(0 70% 50%)";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function StatusPill({ status }: { status: string | null }) {
  const s = status || "pending";
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    pending: { bg: "hsl(40 80% 50% / 0.15)", fg: "hsl(40 80% 50%)", label: "Pendente" },
    approved: { bg: "hsl(120 60% 45% / 0.15)", fg: "hsl(120 60% 45%)", label: "Aprovado" },
    rejected: { bg: "hsl(0 70% 50% / 0.15)", fg: "hsl(0 70% 50%)", label: "Rejeitado" },
  };
  const style = map[s] || map.pending;
  return (
    <span
      className="font-mono text-[10px] px-2 py-0.5 rounded-sm uppercase tracking-wider font-bold"
      style={{ background: style.bg, color: style.fg }}
    >
      {style.label}
    </span>
  );
}

function getSessionStatus(recs: Recording[]) {
  const allApproved = recs.every(r => r.quality_status === "approved" && r.validation_status === "approved");
  const anyRejected = recs.some(r => r.quality_status === "rejected" || r.validation_status === "rejected");
  return allApproved ? "approved" : anyRejected ? "rejected" : "pending";
}

// ---- Track Row ----

function TrackRow({ rec }: { rec: Recording }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const toggle = useCallback(() => {
    if (!rec.file_url) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(rec.file_url);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
    }
  }, [playing, rec.file_url]);

  const m = rec.metadata;

  return (
    <div className="px-4 py-3 border-b border-border/20 space-y-2 last:border-b-0">
      <div className="flex items-center gap-3">
        {rec.file_url && (
          <button onClick={toggle} className="shrink-0 text-accent hover:text-accent/80 transition-colors">
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
        )}
        <span className="font-mono text-[10px] px-1.5 py-0.5 bg-secondary text-muted-foreground rounded-sm shrink-0">
          {rec.recording_type === "mixed" ? "MIX" : "IND"}
        </span>
        <div className="flex-1 min-w-0">
          <span className="font-mono text-sm truncate block text-foreground">
            {rec.discord_username || rec.filename}
          </span>
        </div>
        {rec.duration_seconds != null && (
          <span className="font-mono text-xs text-muted-foreground shrink-0">
            {formatDuration(rec.duration_seconds)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 pl-7 flex-wrap">
        <div className="flex items-center gap-1.5">
          {rec.format && (
            <span className="font-mono text-[9px] px-1.5 py-0.5 bg-secondary/80 text-muted-foreground rounded-sm uppercase">
              {rec.format}
            </span>
          )}
          {rec.sample_rate && (
            <span className="font-mono text-[9px] text-muted-foreground">
              {(rec.sample_rate / 1000).toFixed(rec.sample_rate % 1000 === 0 ? 0 : 1)}kHz
            </span>
          )}
          {rec.bit_depth && (
            <span className="font-mono text-[9px] text-muted-foreground">{rec.bit_depth}bit</span>
          )}
          {rec.channels != null && (
            <span className="font-mono text-[9px] text-muted-foreground">
              {rec.channels === 1 ? "mono" : rec.channels === 2 ? "stereo" : `${rec.channels}ch`}
            </span>
          )}
          {rec.file_size_bytes != null && (
            <span className="font-mono text-[9px] text-muted-foreground">{formatBytes(rec.file_size_bytes)}</span>
          )}
        </div>

        <div className="w-px h-3 bg-border" />

        <div className="flex items-center gap-2">
          {rec.snr_db != null && (
            <span className="font-mono text-[10px] font-bold" style={{ color: snrColor(rec.snr_db) }}>
              SNR {rec.snr_db.toFixed(1)}dB
            </span>
          )}
          {m?.rms_level_db != null && (
            <span className="font-mono text-[10px] font-bold" style={{ color: metricColor(m.rms_level_db, -26, -35) }}>
              RMS {m.rms_level_db.toFixed(1)}dBFS
            </span>
          )}
          {m?.srmr != null && (
            <span className="font-mono text-[10px] font-bold" style={{ color: metricColor(m.srmr, 6, 4) }}>
              SRMR {m.srmr.toFixed(2)}
            </span>
          )}
        </div>

        {(m?.sigmos_ovrl != null || m?.wvmos != null) && (
          <>
            <div className="w-px h-3 bg-border" />
            <div className="flex items-center gap-2">
              {m?.sigmos_ovrl != null && (
                <span className="font-mono text-[10px] font-bold" style={{ color: metricColor(m.sigmos_ovrl, 3.5, 2.5) }}>
                  SigMOS {m.sigmos_ovrl.toFixed(2)}
                </span>
              )}
              {m?.sigmos_sig != null && (
                <span className="font-mono text-[10px] text-muted-foreground">SIG {m.sigmos_sig.toFixed(2)}</span>
              )}
              {m?.sigmos_bak != null && (
                <span className="font-mono text-[10px] text-muted-foreground">BAK {m.sigmos_bak.toFixed(2)}</span>
              )}
              {m?.wvmos != null && (
                <span className="font-mono text-[10px] font-bold" style={{ color: metricColor(m.wvmos, 3.0, 2.0) }}>
                  WVMOS {m.wvmos.toFixed(2)}
                </span>
              )}
            </div>
          </>
        )}

        {m?.effective_bandwidth_hz != null && (
          <>
            <div className="w-px h-3 bg-border" />
            <span className="font-mono text-[10px] text-muted-foreground">
              BW {(m.effective_bandwidth_hz / 1000).toFixed(1)}kHz
            </span>
          </>
        )}

        {rec.transcription_status && (
          <>
            <div className="w-px h-3 bg-border" />
            <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              TR: {rec.transcription_status}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ---- Session block (inside a host) ----

function SessionBlock({
  session,
  profileMap,
  onApproveSession,
  onRejectSession,
  isPending,
}: {
  session: SessionGroup;
  profileMap: Map<string, string>;
  onApproveSession: (recordingIds: string[]) => void;
  onRejectSession: (recordingIds: string[], reason: string) => void;
  isPending: boolean;
}) {
  const [rejectionReason, setRejectionReason] = useState("");
  const recIds = session.recordings.map(r => r.id);
  const sessionStatus = getSessionStatus(session.recordings);

  const duration = session.mixed?.duration_seconds
    || Math.max(...session.individuals.map(r => r.duration_seconds || 0), 0);

  return (
    <div className="border border-border/40 rounded-md bg-card/30 overflow-hidden">
      {/* Session header */}
      <div className="px-4 py-2.5 bg-secondary/20 flex items-center gap-3 flex-wrap">
        <span className="font-mono text-[10px] px-1.5 py-0.5 bg-secondary text-muted-foreground rounded-sm">
          {session.sessionId.slice(0, 8)}
        </span>
        <StatusPill status={sessionStatus} />
        {session.topic && <span className="text-xs text-muted-foreground">· {session.topic}</span>}
        <span className="text-[10px] text-muted-foreground">
          {new Date(session.createdAt).toLocaleDateString("pt-BR")}{" "}
          {new Date(session.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
        </span>
        <div className="flex items-center gap-3 ml-auto">
          <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
            <FileAudio className="h-3 w-3" /> {session.recordings.length}
          </span>
          <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
            <Users className="h-3 w-3" /> {session.individuals.length}
          </span>
          {duration > 0 && (
            <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
              <Clock className="h-3 w-3" /> {formatDuration(duration)}
            </span>
          )}
        </div>
      </div>

      {/* Tracks */}
      <div>
        {session.mixed && (
          <div>
            <div className="px-4 py-1 bg-accent/5">
              <span className="font-mono text-[9px] uppercase tracking-widest text-accent">🎧 Áudio Combinado</span>
            </div>
            <TrackRow rec={session.mixed} />
          </div>
        )}
        {session.individuals.map(r => {
          const userName = r.user_id ? (profileMap.get(r.user_id) || r.discord_username || "Participante") : (r.discord_username || "Participante");
          return (
            <div key={r.id}>
              <div className="px-4 py-1 bg-secondary/20">
                <span className="font-mono text-[10px] text-muted-foreground">👤 {userName}</span>
              </div>
              <TrackRow rec={r} />
            </div>
          );
        })}
      </div>

      {/* Approval controls */}
      {sessionStatus === "pending" && (
        <div className="p-4 border-t border-border/30 bg-secondary/10 space-y-3">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-green-500/30 text-green-600 hover:bg-green-500/10 hover:text-green-600"
              disabled={isPending}
              onClick={() => onApproveSession(recIds)}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Aprovar sessão
            </Button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={rejectionReason} onValueChange={setRejectionReason}>
              <SelectTrigger className="w-full max-w-md text-xs h-8">
                <SelectValue placeholder="Selecione o motivo da rejeição..." />
              </SelectTrigger>
              <SelectContent>
                {REJECTION_REASONS.map(reason => (
                  <SelectItem key={reason} value={reason} className="text-xs">{reason}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-red-500/30 text-red-600 hover:bg-red-500/10 hover:text-red-600 shrink-0"
              disabled={isPending || !rejectionReason}
              onClick={() => { onRejectSession(recIds, rejectionReason); setRejectionReason(""); }}
            >
              <XCircle className="h-3.5 w-3.5" />
              Rejeitar sessão
            </Button>
          </div>
        </div>
      )}

      {sessionStatus === "rejected" && (
        <div className="p-3 border-t border-border/30 bg-destructive/5">
          <span className="font-mono text-[10px] text-destructive">
            Rejeitado: {session.recordings[0]?.quality_rejection_reason || session.recordings[0]?.validation_rejection_reason || "—"}
          </span>
        </div>
      )}
    </div>
  );
}

// ---- Host block (groups sessions by creator) ----

function HostBlock({
  host,
  profileMap,
  onApproveSession,
  onRejectSession,
  isPending,
}: {
  host: HostGroup;
  profileMap: Map<string, string>;
  onApproveSession: (recordingIds: string[]) => void;
  onRejectSession: (recordingIds: string[], reason: string) => void;
  isPending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border/60 rounded-lg bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-secondary/20 transition-colors"
      >
        <div className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center shrink-0">
          <User className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-foreground">{host.hostName}</span>
            {host.pendingSessions > 0 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/40 text-amber-500">
                {host.pendingSessions} pendente{host.pendingSessions > 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {host.sessions.length} {host.sessions.length === 1 ? "sessão" : "sessões"} · {host.totalRecordings} arquivos
          </span>
        </div>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {expanded && (
        <div className="border-t border-border/40 p-4 space-y-4">
          {host.sessions.map(session => (
            <SessionBlock
              key={session.sessionId}
              session={session}
              profileMap={profileMap}
              onApproveSession={onApproveSession}
              onRejectSession={onRejectSession}
              isPending={isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Submission Summary Dashboard ----

interface CampaignStats {
  campaignName: string;
  campaignType: string | null;
  total: number;
  approved: number;
  rejected: number;
  pendingQuality: number;
  pendingValidation: number;
  goodQuality: number;
  badQuality: number;
}

function SubmissionSummary({
  recordings,
  campaignMap,
}: {
  recordings: Recording[];
  campaignMap: Map<string, CampaignInfo>;
}) {
  const stats = useMemo(() => {
    const byCampaign = new Map<string, Recording[]>();
    for (const r of recordings) {
      const key = r.campaign_id || "__none__";
      if (!byCampaign.has(key)) byCampaign.set(key, []);
      byCampaign.get(key)!.push(r);
    }

    const result: CampaignStats[] = [];
    for (const [cid, recs] of byCampaign) {
      const campaign = cid !== "__none__" ? campaignMap.get(cid) : null;
      const approved = recs.filter(r => r.quality_status === "approved" && r.validation_status === "approved").length;
      const rejected = recs.filter(r => r.quality_status === "rejected" || r.validation_status === "rejected").length;
      const pendingQuality = recs.filter(r => r.quality_status === "pending" || !r.quality_status).length;
      const pendingValidation = recs.filter(r => r.quality_status === "approved" && (r.validation_status === "pending" || !r.validation_status)).length;
      const goodQuality = recs.filter(r => {
        const snr = r.snr_db;
        const ovrl = r.metadata?.sigmos_ovrl;
        return (snr != null && snr >= 25) || (ovrl != null && ovrl >= 3.5);
      }).length;
      const badQuality = recs.filter(r => {
        const snr = r.snr_db;
        const ovrl = r.metadata?.sigmos_ovrl;
        return (snr != null && snr < 15) || (ovrl != null && ovrl < 2.5);
      }).length;

      result.push({
        campaignName: campaign?.name || "Sem campanha",
        campaignType: campaign?.campaign_type || null,
        total: recs.length,
        approved,
        rejected,
        pendingQuality,
        pendingValidation,
        goodQuality,
        badQuality,
      });
    }
    result.sort((a, b) => b.total - a.total);
    return result;
  }, [recordings, campaignMap]);

  const totals = useMemo(() => ({
    total: stats.reduce((a, s) => a + s.total, 0),
    approved: stats.reduce((a, s) => a + s.approved, 0),
    rejected: stats.reduce((a, s) => a + s.rejected, 0),
    pendingQuality: stats.reduce((a, s) => a + s.pendingQuality, 0),
    pendingValidation: stats.reduce((a, s) => a + s.pendingValidation, 0),
    goodQuality: stats.reduce((a, s) => a + s.goodQuality, 0),
    badQuality: stats.reduce((a, s) => a + s.badQuality, 0),
  }), [stats]);

  return (
    <Card className="border-border/40 bg-card">
      <CardHeader className="pb-2 pt-5 px-5">
        <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          Resumo de Materiais
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 space-y-4">
        {/* Global counters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          <SummaryPill icon={FileAudio} label="Total" value={totals.total} color="text-foreground" />
          <SummaryPill icon={CheckCircle2} label="Aprovados" value={totals.approved} color="text-green-500" />
          <SummaryPill icon={XCircle} label="Rejeitados" value={totals.rejected} color="text-destructive" />
          <SummaryPill icon={Hourglass} label="Pend. Qualidade" value={totals.pendingQuality} color="text-amber-500" />
          <SummaryPill icon={AlertTriangle} label="Pend. Validação" value={totals.pendingValidation} color="text-orange-400" />
          <SummaryPill icon={ShieldCheck} label="Boa Qualidade" value={totals.goodQuality} color="text-emerald-500" />
          <SummaryPill icon={ShieldX} label="Baixa Qualidade" value={totals.badQuality} color="text-red-400" />
        </div>

        {/* Per-campaign table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/40">
                <th className="text-left py-2 text-muted-foreground font-medium">Campanha</th>
                <th className="text-left py-2 text-muted-foreground font-medium">Tipo</th>
                <th className="text-right py-2 text-muted-foreground font-medium">Total</th>
                <th className="text-right py-2 text-muted-foreground font-medium">Aprovados</th>
                <th className="text-right py-2 text-muted-foreground font-medium">Rejeitados</th>
                <th className="text-right py-2 text-muted-foreground font-medium">Pend. QA</th>
                <th className="text-right py-2 text-muted-foreground font-medium">Pend. VAL</th>
                <th className="text-right py-2 text-muted-foreground font-medium">Boa Qual.</th>
                <th className="text-right py-2 text-muted-foreground font-medium">Baixa Qual.</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s, i) => (
                <tr key={i} className="border-b border-border/20 hover:bg-secondary/20 transition-colors">
                  <td className="py-2 font-medium text-foreground truncate max-w-[200px]">{s.campaignName}</td>
                  <td className="py-2 text-muted-foreground">
                    {s.campaignType && (
                      <span className="font-mono text-[9px] px-1.5 py-0.5 bg-secondary rounded-sm uppercase">
                        {s.campaignType.replace(/_/g, " ")}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right font-bold text-foreground">{s.total}</td>
                  <td className="py-2 text-right font-bold text-green-500">{s.approved}</td>
                  <td className="py-2 text-right font-bold text-destructive">{s.rejected}</td>
                  <td className="py-2 text-right font-bold text-amber-500">{s.pendingQuality}</td>
                  <td className="py-2 text-right font-bold text-orange-400">{s.pendingValidation}</td>
                  <td className="py-2 text-right font-bold text-emerald-500">{s.goodQuality}</td>
                  <td className="py-2 text-right font-bold text-red-400">{s.badQuality}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryPill({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-secondary/50 border border-border/30">
      <Icon className={`h-4 w-4 ${color} opacity-70 shrink-0`} />
      <div className="min-w-0">
        <p className="text-[9px] text-muted-foreground uppercase tracking-wider truncate">{label}</p>
        <p className={`text-lg font-bold ${color}`}>{value}</p>
      </div>
    </div>
  );
}

// ---- Campaign tab content ----

function CampaignTabContent({
  hosts,
  profileMap,
  onApproveSession,
  onRejectSession,
  isPending,
}: {
  hosts: HostGroup[];
  profileMap: Map<string, string>;
  onApproveSession: (recordingIds: string[]) => void;
  onRejectSession: (recordingIds: string[], reason: string) => void;
  isPending: boolean;
}) {
  if (hosts.length === 0) {
    return (
      <div className="text-center py-12 border border-border bg-card rounded-lg">
        <FileAudio className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Nenhuma sessão nesta campanha.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {hosts.map(host => (
        <HostBlock
          key={host.hostName}
          host={host}
          profileMap={profileMap}
          onApproveSession={onApproveSession}
          onRejectSession={onRejectSession}
          isPending={isPending}
        />
      ))}
    </div>
  );
}

// ---- Main page ----

export default function ReviewQueue() {
  const queryClient = useQueryClient();

  const { data: recordings, isLoading } = useQuery({
    queryKey: ["admin_review_queue"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voice_recordings")
        .select("id, filename, duration_seconds, recording_type, session_id, created_at, discord_username, file_url, status, campaign_id, user_id, quality_status, validation_status, quality_rejection_reason, validation_rejection_reason, snr_db, sample_rate, bit_depth, channels, format, file_size_bytes, transcription_status, metadata")
        .not("session_id", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Recording[];
    },
  });

  const campaignIds = useMemo(
    () => [...new Set((recordings || []).map(r => r.campaign_id).filter(Boolean))] as string[],
    [recordings]
  );

  const { data: campaigns } = useQuery({
    queryKey: ["admin_review_campaigns", campaignIds],
    queryFn: async () => {
      if (!campaignIds.length) return [];
      const { data, error } = await supabase
        .from("campaigns")
        .select("id, name, description, campaign_type")
        .in("id", campaignIds);
      if (error) throw error;
      return (data || []) as CampaignInfo[];
    },
    enabled: campaignIds.length > 0,
  });

  const userIds = useMemo(
    () => [...new Set((recordings || []).map(r => r.user_id).filter(Boolean))] as string[],
    [recordings]
  );

  const { data: profiles } = useQuery({
    queryKey: ["admin_review_profiles", userIds],
    queryFn: async () => {
      if (!userIds.length) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email_contact")
        .in("id", userIds);
      if (error) throw error;
      return (data || []) as ProfileInfo[];
    },
    enabled: userIds.length > 0,
  });

  const sessionIds = useMemo(
    () => [...new Set((recordings || []).map(r => r.session_id).filter(Boolean))] as string[],
    [recordings]
  );

  const { data: rooms } = useQuery({
    queryKey: ["admin_review_rooms", sessionIds],
    queryFn: async () => {
      if (!sessionIds.length) return [];
      const { data, error } = await supabase
        .from("rooms")
        .select("id, session_id, topic, creator_name")
        .in("session_id", sessionIds);
      if (error) throw error;
      return (data || []) as RoomInfo[];
    },
    enabled: sessionIds.length > 0,
  });

  const profileMap = useMemo(() => {
    const m = new Map<string, string>();
    profiles?.forEach(p => m.set(p.id, p.full_name || p.email_contact || p.id.slice(0, 8)));
    return m;
  }, [profiles]);

  const campaignMap = useMemo(() => {
    const m = new Map<string, CampaignInfo>();
    campaigns?.forEach(c => m.set(c.id, c));
    return m;
  }, [campaigns]);

  const roomMap = useMemo(() => {
    const m = new Map<string, RoomInfo>();
    rooms?.forEach(r => { if (r.session_id) m.set(r.session_id, r); });
    return m;
  }, [rooms]);

  // Build: campaign → hosts → sessions → recordings
  const { campaignTabs, noCampaignHosts } = useMemo(() => {
    if (!recordings) return { campaignTabs: [], noCampaignHosts: [] };

    const byCampaign = new Map<string, Map<string, Recording[]>>();
    const noCampaignMap = new Map<string, Recording[]>();

    for (const r of recordings) {
      const sid = r.session_id || r.id;
      if (!r.campaign_id) {
        if (!noCampaignMap.has(sid)) noCampaignMap.set(sid, []);
        noCampaignMap.get(sid)!.push(r);
      } else {
        if (!byCampaign.has(r.campaign_id)) byCampaign.set(r.campaign_id, new Map());
        const sessionMap = byCampaign.get(r.campaign_id)!;
        if (!sessionMap.has(sid)) sessionMap.set(sid, []);
        sessionMap.get(sid)!.push(r);
      }
    }

    const buildSessions = (sessionMap: Map<string, Recording[]>): SessionGroup[] => {
      const sessions: SessionGroup[] = [];
      for (const [sid, recs] of sessionMap) {
        const mixed = recs.find(r => r.recording_type === "mixed");
        const individuals = recs.filter(r => r.recording_type !== "mixed");
        const room = roomMap.get(sid);
        // Fallback: resolve uploader name from profile (user_id), then discord_username
        const uploaderRec = recs.find(r => r.user_id) || recs[0];
        const fallbackName = (uploaderRec?.user_id ? profileMap.get(uploaderRec.user_id) : null)
          || recs.find(r => r.discord_username && r.discord_username !== "Multi-Speaker Session")?.discord_username
          || null;
        sessions.push({
          sessionId: sid,
          recordings: recs,
          mixed,
          individuals,
          createdAt: recs[0].created_at,
          topic: room?.topic || null,
          creatorName: room?.creator_name || fallbackName,
        });
      }
      sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return sessions;
    };

    const groupByHost = (sessions: SessionGroup[]): HostGroup[] => {
      const byHost = new Map<string, SessionGroup[]>();
      for (const s of sessions) {
        const hostName = s.creatorName || "Desconhecido";
        if (!byHost.has(hostName)) byHost.set(hostName, []);
        byHost.get(hostName)!.push(s);
      }
      const hosts: HostGroup[] = [];
      for (const [hostName, hostSessions] of byHost) {
        const pendingSessions = hostSessions.filter(s => getSessionStatus(s.recordings) === "pending").length;
        hosts.push({
          hostName,
          sessions: hostSessions,
          totalRecordings: hostSessions.reduce((a, s) => a + s.recordings.length, 0),
          pendingSessions,
        });
      }
      hosts.sort((a, b) => b.pendingSessions - a.pendingSessions);
      return hosts;
    };

    const tabs: { campaign: CampaignInfo; hosts: HostGroup[]; pendingCount: number }[] = [];
    for (const [cid, sessionMap] of byCampaign) {
      const campaign = campaignMap.get(cid) || { id: cid, name: cid.slice(0, 8), description: null, campaign_type: null };
      const sessions = buildSessions(sessionMap);
      const hosts = groupByHost(sessions);
      const pendingCount = sessions.filter(s => getSessionStatus(s.recordings) === "pending").length;
      tabs.push({ campaign, hosts, pendingCount });
    }
    tabs.sort((a, b) => b.pendingCount - a.pendingCount);

    return {
      campaignTabs: tabs,
      noCampaignHosts: groupByHost(buildSessions(noCampaignMap)),
    };
  }, [recordings, campaignMap, roomMap]);

  // Mutations
  const approveSessionMutation = useMutation({
    mutationFn: async ({ recordingIds }: { recordingIds: string[] }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const now = new Date().toISOString();
      for (const id of recordingIds) {
        const { error } = await supabase
          .from("voice_recordings")
          .update({
            quality_status: "approved",
            validation_status: "approved",
            quality_reviewed_at: now,
            validation_reviewed_at: now,
            quality_reviewed_by: user?.id || null,
            validation_reviewed_by: user?.id || null,
          } as any)
          .eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_review_queue"] });
      toast.success("Sessão aprovada");
    },
    onError: (err: any) => toast.error(err.message || "Erro ao aprovar"),
  });

  const rejectSessionMutation = useMutation({
    mutationFn: async ({ recordingIds, reason }: { recordingIds: string[]; reason: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const now = new Date().toISOString();
      for (const id of recordingIds) {
        const { error } = await supabase
          .from("voice_recordings")
          .update({
            quality_status: "rejected",
            validation_status: "rejected",
            quality_rejection_reason: reason,
            validation_rejection_reason: reason,
            quality_reviewed_at: now,
            validation_reviewed_at: now,
            quality_reviewed_by: user?.id || null,
            validation_reviewed_by: user?.id || null,
          } as any)
          .eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_review_queue"] });
      toast.success("Sessão rejeitada");
    },
    onError: (err: any) => toast.error(err.message || "Erro ao rejeitar"),
  });

  const handleApproveSession = (recordingIds: string[]) => approveSessionMutation.mutate({ recordingIds });
  const handleRejectSession = (recordingIds: string[], reason: string) => rejectSessionMutation.mutate({ recordingIds, reason });
  const isMutating = approveSessionMutation.isPending || rejectSessionMutation.isPending;

  const hasNoCampaign = noCampaignHosts.length > 0;
  const allTabs = campaignTabs;
  const defaultTab = allTabs.length > 0 ? allTabs[0].campaign.id : (hasNoCampaign ? "__none__" : "");

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Fila de Aprovação</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {allTabs.length} {allTabs.length === 1 ? "campanha" : "campanhas"}
          {hasNoCampaign && " + legados sem campanha"}
        </p>
      </div>

      {!isLoading && recordings && recordings.length > 0 && (
        <SubmissionSummary recordings={recordings} campaignMap={campaignMap} />
      )}

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
      )}

      {!isLoading && allTabs.length === 0 && !hasNoCampaign && (
        <div className="text-center py-16 border border-border bg-card rounded-lg">
          <FileAudio className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold text-foreground">Nenhuma sessão encontrada</h3>
          <p className="text-sm text-muted-foreground mt-1">As sessões enviadas pelo portal aparecerão aqui.</p>
        </div>
      )}

      {!isLoading && (allTabs.length > 0 || hasNoCampaign) && (
        <Tabs defaultValue={defaultTab} className="w-full">
          <TabsList className="w-full flex-wrap h-auto gap-1.5 bg-secondary/50 p-1.5">
            {allTabs.map(({ campaign, pendingCount }) => (
              <TabsTrigger
                key={campaign.id}
                value={campaign.id}
                className="text-sm px-4 py-2 gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                <span className="truncate max-w-[160px]">{campaign.name}</span>
                {pendingCount > 0 && (
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-amber-500/40 text-amber-500">
                    {pendingCount}
                  </Badge>
                )}
              </TabsTrigger>
            ))}
            {hasNoCampaign && (
              <TabsTrigger
                value="__none__"
                className="text-sm px-4 py-2 gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm text-muted-foreground"
              >
                Sem campanha
              </TabsTrigger>
            )}
          </TabsList>

          {allTabs.map(({ campaign, hosts }) => (
            <TabsContent key={campaign.id} value={campaign.id} className="mt-5">
              <div className="mb-4">
                <h2 className="text-base font-bold text-foreground">{campaign.name}</h2>
                {campaign.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{campaign.description}</p>
                )}
              </div>
              <CampaignTabContent
                hosts={hosts}
                profileMap={profileMap}
                onApproveSession={handleApproveSession}
                onRejectSession={handleRejectSession}
                isPending={isMutating}
              />
            </TabsContent>
          ))}

          {hasNoCampaign && (
            <TabsContent value="__none__" className="mt-5">
              <div className="mb-4">
                <h2 className="text-base font-bold text-foreground">Sem campanha</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Gravações legadas sem vínculo de campanha.</p>
              </div>
              <CampaignTabContent
                hosts={noCampaignHosts}
                profileMap={profileMap}
                onApproveSession={handleApproveSession}
                onRejectSession={handleRejectSession}
                isPending={isMutating}
              />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
