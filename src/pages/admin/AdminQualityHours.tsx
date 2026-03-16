import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format, subDays, startOfDay, endOfDay, isWithinInterval } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, Globe, BarChart3, TrendingUp } from "lucide-react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";

type DateRange = { from: Date; to: Date };

const presets = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

// Relaxed quality tier: ignore missing metrics, classify based on available ones
function computeRelaxedTier(meta: Record<string, unknown>): string | null {
  const snr = typeof meta.snr_db === "number" ? meta.snr_db : null;
  const sigmos = typeof meta.sigmos_ovrl === "number" ? meta.sigmos_ovrl : null;
  const srmr = typeof meta.srmr === "number" ? meta.srmr : null;
  const rms = typeof meta.rms_dbfs === "number" ? meta.rms_dbfs : null;

  // At least one metric must exist
  if (snr === null && sigmos === null && srmr === null && rms === null) return null;

  // PQ: all present metrics must meet PQ thresholds
  const pqChecks = [
    snr !== null ? snr >= 30 : true,
    sigmos !== null ? sigmos >= 3.0 : true,
    srmr !== null ? srmr >= 7.0 : true,
    rms !== null ? rms >= -24 : true,
  ];
  if (pqChecks.every(Boolean)) return "pq";

  // HQ: all present metrics must meet HQ thresholds
  const hqChecks = [
    snr !== null ? snr >= 25 : true,
    sigmos !== null ? sigmos >= 2.3 : true,
    srmr !== null ? srmr >= 5.4 : true,
    rms !== null ? rms >= -26 : true,
  ];
  if (hqChecks.every(Boolean)) return "hq";

  // MQ: present metrics must meet MQ thresholds
  const mqChecks = [
    sigmos !== null ? sigmos >= 2.0 : true,
    srmr !== null ? srmr >= 4.0 : true,
    rms !== null ? rms >= -28 : true,
  ];
  if (mqChecks.every(Boolean)) return "mq";

  return "lq";
}

function useQualityRecordings() {
  return useQuery({
    queryKey: ["admin-quality-hours"],
    queryFn: async () => {
      // Fetch recordings with metrics + user_id + duration
      let allRecs: Array<{
        id: string;
        user_id: string | null;
        duration_seconds: number | null;
        created_at: string;
        metadata: Record<string, unknown> | null;
      }> = [];

      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from("voice_recordings")
          .select("id, user_id, duration_seconds, created_at, metadata")
          .not("metadata", "is", null)
          .order("created_at", { ascending: true })
          .range(from, from + batchSize - 1);

        if (error) throw error;
        if (data) allRecs = allRecs.concat(data as typeof allRecs);
        hasMore = (data?.length || 0) === batchSize;
        from += batchSize;
      }

      return allRecs;
    },
    staleTime: 5 * 60 * 1000,
  });
}

function useProfileCountries() {
  return useQuery({
    queryKey: ["admin-profile-countries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, country");
      if (error) throw error;
      return new Map((data || []).map((p) => [p.id, p.country]));
    },
    staleTime: 5 * 60 * 1000,
  });
}

type DayCountryRow = {
  date: string;
  country: string;
  hq_seconds: number;
  mq_seconds: number;
  pq_seconds: number;
};

function resolveCountryName(raw: string | null | undefined): string {
  if (!raw?.trim()) return "Não informado";
  const code = raw.trim();
  if (code.length === 2) {
    try {
      const dn = new Intl.DisplayNames(["pt"], { type: "region" });
      return dn.of(code.toUpperCase()) || code;
    } catch {
      return code;
    }
  }
  return code;
}

export default function AdminQualityHours() {
  const [range, setRange] = useState<DateRange>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });

  const { data: recordings = [], isLoading: loadingRecs } = useQualityRecordings();
  const { data: countryMap, isLoading: loadingProfiles } = useProfileCountries();
  const isLoading = loadingRecs || loadingProfiles;

  const activeDays = Math.round((range.to.getTime() - range.from.getTime()) / 86400000);

  const { byCountry, byDay, totals } = useMemo(() => {
    if (!countryMap) return { byCountry: [], byDay: [], totals: { pq: 0, hq: 0, mq: 0 } };

    const countryAgg: Record<string, { pq: number; hq: number; mq: number }> = {};
    const dayAgg: Record<string, { pq: number; hq: number; mq: number }> = {};
    let totalPq = 0, totalHq = 0, totalMq = 0;

    for (const rec of recordings) {
      if (!rec.duration_seconds || rec.duration_seconds <= 0) continue;
      const createdAt = new Date(rec.created_at);
      if (!isWithinInterval(createdAt, { start: startOfDay(range.from), end: endOfDay(range.to) })) continue;

      const meta = (rec.metadata || {}) as Record<string, unknown>;
      const tier = computeRelaxedTier(meta);
      if (!tier || tier === "lq") continue;

      const secs = rec.duration_seconds;
      const country = resolveCountryName(countryMap.get(rec.user_id || ""));
      const dateKey = createdAt.toISOString().slice(0, 10);

      if (!countryAgg[country]) countryAgg[country] = { pq: 0, hq: 0, mq: 0 };
      if (!dayAgg[dateKey]) dayAgg[dateKey] = { pq: 0, hq: 0, mq: 0 };

      if (tier === "pq") {
        countryAgg[country].pq += secs;
        dayAgg[dateKey].pq += secs;
        totalPq += secs;
      } else if (tier === "hq") {
        countryAgg[country].hq += secs;
        dayAgg[dateKey].hq += secs;
        totalHq += secs;
      } else if (tier === "mq") {
        countryAgg[country].mq += secs;
        dayAgg[dateKey].mq += secs;
        totalMq += secs;
      }
    }

    const byCountry = Object.entries(countryAgg)
      .map(([country, v]) => ({ country, ...v, total: v.pq + v.hq + v.mq }))
      .sort((a, b) => b.total - a.total);

    // Fill all days in range
    const dayEntries: typeof byDay = [];
    const cursor = new Date(startOfDay(range.from));
    const end = endOfDay(range.to);
    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 10);
      const d = dayAgg[key] || { pq: 0, hq: 0, mq: 0 };
      dayEntries.push({ date: key, pq: d.pq / 3600, hq: d.hq / 3600, mq: d.mq / 3600 });
      cursor.setDate(cursor.getDate() + 1);
    }

    return {
      byCountry,
      byDay: dayEntries,
      totals: { pq: totalPq, hq: totalHq, mq: totalMq },
    };
  }, [recordings, countryMap, range]);

  const fmtHours = (secs: number) => {
    const h = secs / 3600;
    return h < 1 ? `${(h * 60).toFixed(0)}min` : `${h.toFixed(1)}h`;
  };

  const chartConfig = {
    pq: { label: "PQ (Platina)", color: "hsl(210 80% 55%)" },
    hq: { label: "HQ (Ouro)", color: "hsl(155 72% 42%)" },
    mq: { label: "MQ (Prata)", color: "hsl(45 90% 55%)" },
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">
            Horas por Qualidade & País
          </h1>
          <p className="text-muted-foreground text-xs mt-1">
            Classificação relaxada — métricas ausentes são ignoradas
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard label="PQ (Platina)" value={fmtHours(totals.pq)} color="hsl(210 80% 55%)" />
        <SummaryCard label="HQ (Ouro)" value={fmtHours(totals.hq)} color="hsl(155 72% 42%)" />
        <SummaryCard label="MQ (Prata)" value={fmtHours(totals.mq)} color="hsl(45 90% 55%)" />
      </div>

      {/* Chart */}
      <Card className="border-border/40 bg-card overflow-hidden">
        <CardHeader className="pb-0 pt-5 px-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              Horas por Dia
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
          {isLoading ? (
            <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
              Carregando...
            </div>
          ) : (
            <ChartContainer config={chartConfig} className="h-[300px] w-full">
              <BarChart data={byDay} margin={{ top: 10, right: 16, bottom: 0, left: -10 }}>
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
                  tickFormatter={(v) => `${v}h`}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(v) =>
                        format(new Date(v as string), "dd 'de' MMMM", { locale: ptBR })
                      }
                      formatter={(value, name) => [
                        `${Number(value).toFixed(2)}h`,
                        chartConfig[name as keyof typeof chartConfig]?.label || name,
                      ]}
                    />
                  }
                />
                <Bar dataKey="pq" stackId="a" fill="hsl(210 80% 55%)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="hq" stackId="a" fill="hsl(155 72% 42%)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="mq" stackId="a" fill="hsl(45 90% 55%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="flex items-center gap-5 justify-center">
        <LegendDot color="hsl(210 80% 55%)" label="PQ (Platina)" />
        <LegendDot color="hsl(155 72% 42%)" label="HQ (Ouro)" />
        <LegendDot color="hsl(45 90% 55%)" label="MQ (Prata)" />
      </div>

      {/* Country Breakdown */}
      <Card className="border-border/40 bg-card">
        <CardHeader className="pb-2 pt-5 px-5">
          <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            Horas por País
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Carregando...</p>
          ) : byCountry.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum dado encontrado no período.</p>
          ) : (
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
              {/* Header */}
              <div className="grid grid-cols-[1fr_80px_80px_80px_80px] gap-2 text-[10px] text-muted-foreground uppercase tracking-wider font-semibold border-b border-border/30 pb-2">
                <span>País</span>
                <span className="text-right">PQ</span>
                <span className="text-right">HQ</span>
                <span className="text-right">MQ</span>
                <span className="text-right">Total</span>
              </div>
              {byCountry.map(({ country, pq, hq, mq, total }) => (
                <div
                  key={country}
                  className="grid grid-cols-[1fr_80px_80px_80px_80px] gap-2 items-center"
                >
                  <span className="text-xs text-foreground font-medium truncate" title={country}>
                    {country}
                  </span>
                  <span className="text-xs text-right font-mono text-[hsl(210_80%_65%)]">
                    {fmtHours(pq)}
                  </span>
                  <span className="text-xs text-right font-mono text-[hsl(155_72%_52%)]">
                    {fmtHours(hq)}
                  </span>
                  <span className="text-xs text-right font-mono text-[hsl(45_90%_55%)]">
                    {fmtHours(mq)}
                  </span>
                  <span className="text-xs text-right font-bold text-foreground">
                    {fmtHours(total)}
                  </span>
                </div>
              ))}
              {/* Totals row */}
              <div className="grid grid-cols-[1fr_80px_80px_80px_80px] gap-2 items-center border-t border-border/30 pt-2 mt-2">
                <span className="text-xs text-foreground font-bold">TOTAL</span>
                <span className="text-xs text-right font-mono font-bold text-[hsl(210_80%_65%)]">
                  {fmtHours(totals.pq)}
                </span>
                <span className="text-xs text-right font-mono font-bold text-[hsl(155_72%_52%)]">
                  {fmtHours(totals.hq)}
                </span>
                <span className="text-xs text-right font-mono font-bold text-[hsl(45_90%_55%)]">
                  {fmtHours(totals.mq)}
                </span>
                <span className="text-xs text-right font-bold text-foreground">
                  {fmtHours(totals.pq + totals.hq + totals.mq)}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-2xl p-5 bg-secondary border border-border/30">
      <div className="flex items-center gap-3">
        <div className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-3xl font-extrabold text-foreground tracking-tight mt-2">{value}</p>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}
