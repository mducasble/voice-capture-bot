import { useState, useMemo } from "react";
import { Users, Zap, DollarSign, TrendingUp, CalendarIcon, Mic2, Clock, HardDrive, Server, Database, FileAudio, FileArchive, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format, subDays, isWithinInterval, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useRecordings, useRecordingStats } from "@/hooks/useRecordings";
import { useQuery } from "@tanstack/react-query";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";

type DateRange = { from: Date; to: Date };

const presets = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

function useProfiles() {
  return useQuery({
    queryKey: ["admin-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, created_at, country");
      if (error) throw error;
      return data || [];
    },
  });
}

function useParticipants() {
  return useQuery({
    queryKey: ["admin-participants"],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaign_participants").select("id, user_id, joined_at, campaign_id");
      if (error) throw error;
      return data || [];
    },
  });
}

function useEarnings() {
  return useQuery({
    queryKey: ["admin-earnings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("earnings_ledger").select("id, amount, currency, status, created_at");
      if (error) throw error;
      return data || [];
    },
  });
}

function buildDailyData(
  profiles: { created_at: string }[],
  participants: { joined_at: string; user_id: string }[],
  range: DateRange
) {
  const days: Record<string, { date: string; users: number; quests: number }> = {};
  // Use UTC-consistent date keys to avoid timezone mismatches
  const toKey = (d: Date) => d.toISOString().slice(0, 10);
  const current = new Date(startOfDay(range.from));
  const end = endOfDay(range.to);
  while (current <= end) {
    const key = toKey(current);
    days[key] = { date: key, users: 0, quests: 0 };
    current.setDate(current.getDate() + 1);
  }
  profiles.forEach((p) => {
    const d = toKey(new Date(p.created_at));
    if (days[d]) days[d].users++;
  });
  const dailyQuestUsers: Record<string, Set<string>> = {};
  participants.forEach((p) => {
    const d = toKey(new Date(p.joined_at));
    if (days[d]) {
      if (!dailyQuestUsers[d]) dailyQuestUsers[d] = new Set();
      dailyQuestUsers[d].add(p.user_id);
    }
  });
  Object.entries(dailyQuestUsers).forEach(([d, set]) => {
    if (days[d]) days[d].quests = set.size;
  });
  return Object.values(days).sort((a, b) => a.date.localeCompare(b.date));
}

/* Bold gradient stat card matching the reference dark UI */
function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  gradientClass,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ElementType;
  gradientClass: string;
}) {
  return (
    <div className={cn("rounded-2xl p-5 transition-all duration-200 hover:scale-[1.02]", gradientClass)}>
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-xs font-medium text-white/60 uppercase tracking-wider">{title}</p>
          <p className="text-3xl font-extrabold text-white tracking-tight">{value}</p>
          {subtitle && <p className="text-xs text-white/50">{subtitle}</p>}
        </div>
        <div className="p-2.5 rounded-xl bg-white/10 backdrop-blur-sm">
          <Icon className="h-5 w-5 text-white/80" />
        </div>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const [range, setRange] = useState<DateRange>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });

  const { data: profiles = [] } = useProfiles();
  const { data: participants = [] } = useParticipants();
  const { data: earnings = [] } = useEarnings();
  const { data: recordings } = useRecordings();
  const recStats = useRecordingStats(recordings);

  const totalUsers = profiles.length;
  const uniqueQuestUsers = useMemo(() => new Set(participants.map((p) => p.user_id)).size, [participants]);
  const totalDistributed = useMemo(
    () => earnings.filter((e) => e.status === "credited" || e.status === "paid").reduce((sum, e) => sum + Number(e.amount), 0),
    [earnings]
  );

  const filteredProfiles = useMemo(
    () => profiles.filter((p) => isWithinInterval(new Date(p.created_at), { start: startOfDay(range.from), end: endOfDay(range.to) })),
    [profiles, range]
  );
  const filteredParticipants = useMemo(
    () => participants.filter((p) => isWithinInterval(new Date(p.joined_at), { start: startOfDay(range.from), end: endOfDay(range.to) })),
    [participants, range]
  );

  const chartData = useMemo(() => buildDailyData(filteredProfiles, filteredParticipants, range), [filteredProfiles, filteredParticipants, range]);

  const chartConfig = {
    users: { label: "Novos Usuários", color: "hsl(265 75% 58%)" },
    quests: { label: "Fazendo Quest", color: "hsl(155 72% 42%)" },
  };

  const activeDays = Math.round((range.to.getTime() - range.from.getTime()) / 86400000);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-xs mt-1">
            {format(new Date(), "EEEE, dd 'de' MMMM", { locale: ptBR })}
          </p>
        </div>
      </div>

      {/* Top Stats — bold gradient cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Usuários Inscritos"
          value={totalUsers.toLocaleString("pt-BR")}
          icon={Users}
          gradientClass="admin-gradient-card-purple"
        />
        <StatCard
          title="Fazendo Quest"
          value={uniqueQuestUsers.toLocaleString("pt-BR")}
          icon={Zap}
          gradientClass="admin-gradient-card-green"
        />
        <StatCard
          title="Total Distribuído"
          value={`$${totalDistributed.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon={DollarSign}
          gradientClass="admin-gradient-card-amber"
        />
      </div>

      {/* Chart */}
      <Card className="border-border/40 bg-card overflow-hidden">
        <CardHeader className="pb-0 pt-5 px-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Crescimento
            </CardTitle>
            <div className="flex items-center gap-1 bg-secondary rounded-lg p-0.5 border border-border/30">
              {presets.map((p) => (
                <button
                  key={p.days}
                  className={cn(
                    "px-3 py-1 text-[11px] font-medium rounded-md transition-all",
                    activeDays === p.days
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => setRange({ from: subDays(new Date(), p.days), to: new Date() })}
                >
                  {p.label}
                </button>
              ))}
              <Popover>
                <PopoverTrigger asChild>
                  <button className="px-2 py-1 text-[11px] font-medium rounded-md text-muted-foreground hover:text-foreground transition-colors">
                    <CalendarIcon className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="range"
                    selected={{ from: range.from, to: range.to }}
                    onSelect={(r) => {
                      if (r?.from && r?.to) setRange({ from: r.from, to: r.to });
                      else if (r?.from) setRange({ from: r.from, to: r.from });
                    }}
                    numberOfMonths={2}
                    locale={ptBR}
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4 px-2 pb-2">
          <ChartContainer config={chartConfig} className="h-[280px] w-full">
            <AreaChart data={chartData} margin={{ top: 10, right: 16, bottom: 0, left: -10 }}>
              <defs>
                <linearGradient id="fillUsers" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(265 75% 58%)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(265 75% 58%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="fillQuests" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(155 72% 42%)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="hsl(155 72% 42%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="hsl(240 6% 14%)" />
              <XAxis
                dataKey="date"
                tickFormatter={(v) => format(new Date(v), "dd/MM")}
                tick={{ fontSize: 10, fill: "hsl(0 0% 40%)" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(0 0% 40%)" }}
                tickLine={false}
                axisLine={false}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(v) => format(new Date(v as string), "dd 'de' MMMM", { locale: ptBR })}
                  />
                }
              />
              <Area type="monotone" dataKey="users" stroke="hsl(265 75% 58%)" strokeWidth={2} fill="url(#fillUsers)" dot={false} activeDot={{ r: 4, fill: "hsl(265 75% 58%)", strokeWidth: 2, stroke: "hsl(240 12% 4%)" }} />
              <Area type="monotone" dataKey="quests" stroke="hsl(155 72% 42%)" strokeWidth={2} fill="url(#fillQuests)" dot={false} activeDot={{ r: 4, fill: "hsl(155 72% 42%)", strokeWidth: 2, stroke: "hsl(240 12% 4%)" }} />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="flex items-center gap-5 justify-center">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-primary" />
          <span className="text-[11px] text-muted-foreground">Novos Usuários</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-accent" />
          <span className="text-[11px] text-muted-foreground">Fazendo Quest</span>
        </div>
      </div>

      {/* Users by Country */}
      <CountryBreakdown profiles={profiles} />

      {/* Infrastructure — smaller gradient cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Gravações" value={recStats.totalRecordings.toLocaleString("pt-BR")} icon={Mic2} gradientClass="admin-gradient-card-purple" />
        <StatCard title="Duração" value={recStats.totalDuration} icon={Clock} gradientClass="admin-gradient-card-blue" />
        <StatCard title="Armazenamento" value={recStats.totalSize} icon={HardDrive} gradientClass="admin-gradient-card-amber" />
        <StatCard title="Servidores" value={recStats.uniqueServers.toLocaleString("pt-BR")} icon={Server} gradientClass="admin-gradient-card-green" />
      </div>

      {/* Storage Breakdown */}
      <Card className="border-border/40 bg-card">
        <CardHeader className="pb-2 pt-5 px-5">
          <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            Armazenamento
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 px-5">
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Uso total</span>
              <span className="font-medium text-foreground">
                {formatBytes(recStats.storageStats.totalBytes)} / {formatBytes(1024 * 1024 * 1024)}
              </span>
            </div>
            <Progress
              value={Math.min(100, (recStats.storageStats.totalBytes / (1024 * 1024 * 1024)) * 100)}
              className="h-2 rounded-full"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary border border-border/30">
              <FileAudio className="h-6 w-6 text-primary opacity-60" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Originais</p>
                <p className="text-sm font-bold text-foreground">{formatBytes(recStats.storageStats.totalBytes)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary border border-border/30">
              <FileArchive className="h-6 w-6 text-accent opacity-60" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Comprimidos</p>
                <p className="text-sm font-bold text-foreground">{formatBytes(recStats.storageStats.compressedBytes)}</p>
                {recStats.storageStats.totalBytes > 0 && (
                  <p className="text-[10px] font-semibold text-accent">
                    -{((1 - recStats.storageStats.compressedBytes / recStats.storageStats.totalBytes) * 100).toFixed(0)}%
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary border border-border/30">
              <Mic2 className="h-6 w-6 text-muted-foreground opacity-40" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Média/arquivo</p>
                <p className="text-sm font-bold text-foreground">
                  {recStats.storageStats.recordingCount > 0
                    ? formatBytes(recStats.storageStats.totalBytes / recStats.storageStats.recordingCount)
                    : "0 B"}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CountryBreakdown({ profiles }: { profiles: { country?: string | null }[] }) {
  const countryData = useMemo(() => {
    let dn: Intl.DisplayNames | null = null;
    try {
      dn = new Intl.DisplayNames(["pt"], { type: "region" });
    } catch { /* fallback */ }

    const map: Record<string, number> = {};
    profiles.forEach((p) => {
      const raw = p.country?.trim();
      if (!raw) return; // skip users without country
      // Resolve 2-letter ISO codes to localized names
      let label = raw;
      if (raw.length === 2 && dn) {
        try { label = dn.of(raw.toUpperCase()) || raw; } catch { /* keep raw */ }
      }
      map[label] = (map[label] || 0) + 1;
    });
    return Object.entries(map)
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count);
  }, [profiles]);

  const total = profiles.length;

  return (
    <Card className="border-border/40 bg-card">
      <CardHeader className="pb-2 pt-5 px-5">
        <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          Usuários por País
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
          {countryData.map(({ country, count }) => {
            const pct = total > 0 ? (count / total) * 100 : 0;
            return (
              <div key={country} className="flex items-center gap-3">
                <span className="text-xs text-foreground font-medium w-36 truncate" title={country}>
                  {country}
                </span>
                <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-foreground w-10 text-right">{count}</span>
                <span className="text-[10px] text-muted-foreground w-12 text-right">{pct.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
