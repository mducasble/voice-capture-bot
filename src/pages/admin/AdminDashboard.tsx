import { useState, useMemo } from "react";
import { Users, Zap, DollarSign, TrendingUp, CalendarIcon, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format, subDays, isWithinInterval, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
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
      const { data, error } = await supabase.from("profiles").select("id, created_at");
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
  const current = new Date(range.from);
  while (current <= range.to) {
    const key = format(current, "yyyy-MM-dd");
    days[key] = { date: key, users: 0, quests: 0 };
    current.setDate(current.getDate() + 1);
  }
  profiles.forEach((p) => {
    const d = format(new Date(p.created_at), "yyyy-MM-dd");
    if (days[d]) days[d].users++;
  });
  const dailyQuestUsers: Record<string, Set<string>> = {};
  participants.forEach((p) => {
    const d = format(new Date(p.joined_at), "yyyy-MM-dd");
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

function StatCard({
  title,
  value,
  change,
  icon: Icon,
  gradient,
  iconBg,
}: {
  title: string;
  value: string;
  change?: { value: string; positive: boolean };
  icon: React.ElementType;
  gradient: string;
  iconBg: string;
}) {
  return (
    <Card className="group relative overflow-hidden border-0 shadow-md hover:shadow-xl transition-all duration-300">
      <div className={cn("absolute inset-0 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity", gradient)} />
      <CardContent className="p-6 relative">
        <div className="flex items-start justify-between">
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-3xl font-extrabold tracking-tight text-foreground">{value}</p>
            {change && (
              <div className={cn("flex items-center gap-1 text-xs font-semibold", change.positive ? "text-accent" : "text-destructive")}>
                {change.positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                {change.value}
              </div>
            )}
          </div>
          <div className={cn("p-3 rounded-2xl shadow-lg", iconBg)}>
            <Icon className="h-5 w-5 text-primary-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
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
    users: { label: "Novos Usuários", color: "hsl(250 80% 55%)" },
    quests: { label: "Fazendo Quest", color: "hsl(155 72% 42%)" },
  };

  const activeDays = Math.round((range.to.getTime() - range.from.getTime()) / 86400000);

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1.5">Visão geral da plataforma KGen</p>
        </div>
        <p className="text-xs text-muted-foreground font-medium">
          {format(new Date(), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard
          title="Usuários Inscritos"
          value={totalUsers.toLocaleString("pt-BR")}
          icon={Users}
          gradient="bg-gradient-to-br from-primary to-[hsl(280_72%_60%)]"
          iconBg="bg-gradient-to-br from-[hsl(250_80%_55%)] to-[hsl(280_72%_60%)] shadow-primary/30"
        />
        <StatCard
          title="Fazendo Quest"
          value={uniqueQuestUsers.toLocaleString("pt-BR")}
          icon={Zap}
          gradient="bg-gradient-to-br from-accent to-[hsl(170_60%_45%)]"
          iconBg="bg-gradient-to-br from-[hsl(155_72%_42%)] to-[hsl(170_60%_45%)] shadow-accent/30"
        />
        <StatCard
          title="Total Distribuído"
          value={`$${totalDistributed.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
          icon={DollarSign}
          gradient="bg-gradient-to-br from-[hsl(38_92%_50%)] to-[hsl(25_90%_55%)]"
          iconBg="bg-gradient-to-br from-[hsl(38_92%_50%)] to-[hsl(25_90%_55%)] shadow-[hsl(38_92%_50%)]/30"
        />
      </div>

      {/* Chart */}
      <Card className="border-0 shadow-md overflow-hidden">
        <CardHeader className="pb-0 pt-6 px-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <CardTitle className="text-lg font-bold text-foreground flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-primary" />
                </div>
                Crescimento
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1 ml-[42px]">Novos usuários e participações em quests</p>
            </div>
            <div className="flex items-center gap-1.5 bg-secondary rounded-xl p-1">
              {presets.map((p) => (
                <button
                  key={p.days}
                  className={cn(
                    "px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200",
                    activeDays === p.days
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => setRange({ from: subDays(new Date(), p.days), to: new Date() })}
                >
                  {p.label}
                </button>
              ))}
              <Popover>
                <PopoverTrigger asChild>
                  <button className="px-3 py-1.5 text-xs font-semibold rounded-lg text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5">
                    <CalendarIcon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">
                      {format(range.from, "dd/MM")} – {format(range.to, "dd/MM")}
                    </span>
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
        <CardContent className="pt-6 px-2 pb-2">
          <ChartContainer config={chartConfig} className="h-[340px] w-full">
            <AreaChart data={chartData} margin={{ top: 10, right: 16, bottom: 0, left: -10 }}>
              <defs>
                <linearGradient id="fillUsers" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(250 80% 55%)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="hsl(250 80% 55%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="fillQuests" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(155 72% 42%)" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="hsl(155 72% 42%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="hsl(220 16% 92%)" />
              <XAxis
                dataKey="date"
                tickFormatter={(v) => format(new Date(v), "dd/MM")}
                tick={{ fontSize: 11, fill: "hsl(220 10% 50%)" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(220 10% 50%)" }}
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
              <Area type="monotone" dataKey="users" stroke="hsl(250 80% 55%)" strokeWidth={2.5} fill="url(#fillUsers)" dot={false} activeDot={{ r: 5, fill: "hsl(250 80% 55%)", strokeWidth: 2, stroke: "white" }} />
              <Area type="monotone" dataKey="quests" stroke="hsl(155 72% 42%)" strokeWidth={2.5} fill="url(#fillQuests)" dot={false} activeDot={{ r: 5, fill: "hsl(155 72% 42%)", strokeWidth: 2, stroke: "white" }} />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="flex items-center gap-6 justify-center">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full bg-primary shadow-sm shadow-primary/40" />
          <span className="text-xs font-medium text-muted-foreground">Novos Usuários</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full bg-accent shadow-sm shadow-accent/40" />
          <span className="text-xs font-medium text-muted-foreground">Fazendo Quest</span>
        </div>
      </div>
    </div>
  );
}
