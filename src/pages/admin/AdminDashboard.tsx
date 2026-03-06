import { useState, useMemo } from "react";
import { Users, Zap, DollarSign, TrendingUp, CalendarIcon } from "lucide-react";
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
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";

type DateRange = { from: Date; to: Date };

const presets = [
  { label: "7 dias", days: 7 },
  { label: "30 dias", days: 30 },
  { label: "90 dias", days: 90 },
];

function useProfiles() {
  return useQuery({
    queryKey: ["admin-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, created_at");
      if (error) throw error;
      return data || [];
    },
  });
}

function useParticipants() {
  return useQuery({
    queryKey: ["admin-participants"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_participants")
        .select("id, user_id, joined_at, campaign_id");
      if (error) throw error;
      return data || [];
    },
  });
}

function useEarnings() {
  return useQuery({
    queryKey: ["admin-earnings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("earnings_ledger")
        .select("id, amount, currency, status, created_at");
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

  // Count unique users per day
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

export default function AdminDashboard() {
  const [range, setRange] = useState<DateRange>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });

  const { data: profiles = [] } = useProfiles();
  const { data: participants = [] } = useParticipants();
  const { data: earnings = [] } = useEarnings();

  const totalUsers = profiles.length;

  const uniqueQuestUsers = useMemo(() => {
    const set = new Set(participants.map((p) => p.user_id));
    return set.size;
  }, [participants]);

  const totalDistributed = useMemo(() => {
    return earnings
      .filter((e) => e.status === "credited" || e.status === "paid")
      .reduce((sum, e) => sum + Number(e.amount), 0);
  }, [earnings]);

  const filteredProfiles = useMemo(
    () =>
      profiles.filter((p) =>
        isWithinInterval(new Date(p.created_at), {
          start: startOfDay(range.from),
          end: endOfDay(range.to),
        })
      ),
    [profiles, range]
  );

  const filteredParticipants = useMemo(
    () =>
      participants.filter((p) =>
        isWithinInterval(new Date(p.joined_at), {
          start: startOfDay(range.from),
          end: endOfDay(range.to),
        })
      ),
    [participants, range]
  );

  const chartData = useMemo(
    () => buildDailyData(filteredProfiles, filteredParticipants, range),
    [filteredProfiles, filteredParticipants, range]
  );

  const chartConfig = {
    users: { label: "Novos Usuários", color: "hsl(243 75% 59%)" },
    quests: { label: "Fazendo Quest", color: "hsl(139 70% 45%)" },
  };

  const stats = [
    {
      title: "Usuários Inscritos",
      value: totalUsers.toLocaleString("pt-BR"),
      icon: Users,
      color: "text-primary bg-primary/10",
    },
    {
      title: "Fazendo Quest",
      value: uniqueQuestUsers.toLocaleString("pt-BR"),
      icon: Zap,
      color: "text-accent bg-accent/10",
    },
    {
      title: "Total Distribuído",
      value: `$${totalDistributed.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
      icon: DollarSign,
      color: "text-emerald-600 bg-emerald-50",
    },
  ];

  return (
    <div className="space-y-8 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Visão geral da plataforma</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {stats.map((s) => (
          <Card key={s.title} className="border shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{s.title}</p>
                  <p className="text-3xl font-bold text-foreground">{s.value}</p>
                </div>
                <div className={cn("p-3 rounded-xl", s.color)}>
                  <s.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart Section */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              Crescimento
            </CardTitle>
            <div className="flex items-center gap-2">
              {presets.map((p) => (
                <Button
                  key={p.days}
                  size="sm"
                  variant={
                    Math.round(
                      (range.to.getTime() - range.from.getTime()) / 86400000
                    ) === p.days
                      ? "default"
                      : "outline"
                  }
                  className="text-xs h-8"
                  onClick={() =>
                    setRange({ from: subDays(new Date(), p.days), to: new Date() })
                  }
                >
                  {p.label}
                </Button>
              ))}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="text-xs h-8 gap-1.5">
                    <CalendarIcon className="h-3.5 w-3.5" />
                    {format(range.from, "dd/MM", { locale: ptBR })} –{" "}
                    {format(range.to, "dd/MM", { locale: ptBR })}
                  </Button>
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
        <CardContent className="pt-4">
          <ChartContainer config={chartConfig} className="h-[320px] w-full">
            <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="fillUsers" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(243 75% 59%)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(243 75% 59%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="fillQuests" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(139 70% 45%)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(139 70% 45%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(220 13% 91%)" />
              <XAxis
                dataKey="date"
                tickFormatter={(v) => format(new Date(v), "dd/MM")}
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(v) =>
                      format(new Date(v as string), "dd 'de' MMMM", { locale: ptBR })
                    }
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="users"
                stroke="hsl(243 75% 59%)"
                strokeWidth={2}
                fill="url(#fillUsers)"
              />
              <Area
                type="monotone"
                dataKey="quests"
                stroke="hsl(139 70% 45%)"
                strokeWidth={2}
                fill="url(#fillQuests)"
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
