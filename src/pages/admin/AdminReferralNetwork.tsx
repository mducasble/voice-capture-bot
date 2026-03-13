import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, Users, Network, TrendingUp, ChevronDown, Mic, Loader2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface NetworkUser {
  user_id: string;
  full_name: string | null;
  email_contact: string | null;
  country: string | null;
  referral_code: string | null;
  level_1_count: number;
  level_2_count: number;
  level_3_count: number;
  level_4_count: number;
  level_5_count: number;
  total_network: number;
}

interface NetworkMember {
  user_id: string;
  full_name: string | null;
  country: string | null;
  level: number;
  session_count: number;
}

function useNetworkSessions(userId: string | null) {
  return useQuery({
    queryKey: ["network-sessions", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "get_network_members_with_sessions" as any,
        { p_user_id: userId }
      );
      if (error) throw error;
      return (data as unknown as NetworkMember[]) || [];
    },
    staleTime: 60_000,
  });
}

function NetworkAccordionRow({
  user,
  index,
  countryLabel,
}: {
  user: NetworkUser;
  index: number;
  countryLabel: (c: string | null) => string;
}) {
  const [open, setOpen] = useState(false);
  const [loadUserId, setLoadUserId] = useState<string | null>(null);

  const handleOpen = useCallback(
    (isOpen: boolean) => {
      setOpen(isOpen);
      if (isOpen && !loadUserId) {
        setLoadUserId(user.user_id);
      }
    },
    [user.user_id, loadUserId]
  );

  const { data: members = [], isLoading } = useNetworkSessions(loadUserId);

  const totalSessions = members.reduce((s, m) => s + m.session_count, 0);

  return (
    <Collapsible open={open} onOpenChange={handleOpen}>
      <CollapsibleTrigger asChild>
        <div
          className="grid items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors border-b border-border"
          style={{ gridTemplateColumns: "2rem 1fr 6rem 5rem repeat(5,3rem) 3.5rem 3.5rem 2rem" }}
        >
          <span className="text-muted-foreground font-mono text-xs">{index + 1}</span>
          <div className="flex flex-col min-w-0">
            <span className="font-medium truncate">{user.full_name || "—"}</span>
            {user.email_contact && (
              <span className="text-xs text-muted-foreground truncate">{user.email_contact}</span>
            )}
          </div>
          <span className="text-sm truncate">{countryLabel(user.country)}</span>
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded truncate">{user.referral_code || "—"}</code>
          {[user.level_1_count, user.level_2_count, user.level_3_count, user.level_4_count, user.level_5_count].map(
            (count, i) => (
              <span key={i} className="text-center text-sm">
                {count > 0 ? <Badge variant="secondary">{count}</Badge> : <span className="text-muted-foreground">0</span>}
              </span>
            )
          )}
          <span className="text-center">
            <Badge className="bg-primary text-primary-foreground">{user.total_network}</Badge>
          </span>
          <span className="text-center">
            {loadUserId && !isLoading ? (
              <Badge variant="outline" className="gap-1">
                <Mic className="h-3 w-3" />
                {totalSessions}
              </Badge>
            ) : null}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="bg-muted/20 border-b border-border">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando rede...
            </div>
          ) : members.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">Nenhum membro na rede.</div>
          ) : (
            <div className="px-6 py-3">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Membros da rede
                </span>
                <Badge variant="outline" className="text-xs gap-1">
                  <Mic className="h-3 w-3" /> {totalSessions} sessões
                </Badge>
              </div>
              <div className="grid gap-1">
                {/* Header */}
                <div
                  className="grid items-center gap-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-1"
                  style={{ gridTemplateColumns: "1fr 5rem 4rem 5rem" }}
                >
                  <span>Nome</span>
                  <span>País</span>
                  <span className="text-center">Nível</span>
                  <span className="text-center">Sessões</span>
                </div>
                {members.map((m) => (
                  <div
                    key={m.user_id}
                    className="grid items-center gap-3 px-3 py-2 rounded hover:bg-muted/40 transition-colors"
                    style={{ gridTemplateColumns: "1fr 5rem 4rem 5rem" }}
                  >
                    <span className="text-sm truncate">{m.full_name || "—"}</span>
                    <span className="text-xs text-muted-foreground">{countryLabel(m.country)}</span>
                    <span className="text-center">
                      <Badge variant="secondary" className="text-xs">
                        L{m.level}
                      </Badge>
                    </span>
                    <span className="text-center">
                      {m.session_count > 0 ? (
                        <Badge variant="outline" className="gap-1 text-xs">
                          <Mic className="h-3 w-3" />
                          {m.session_count}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">0</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function AdminReferralNetwork() {
  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [levelFilter, setLevelFilter] = useState<string>("all");

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-referral-network"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_referral_network_stats" as any);
      if (error) throw error;
      return (data as unknown as NetworkUser[]) || [];
    },
  });

  const countries = useMemo(() => {
    const set = new Set<string>();
    users.forEach((u) => {
      if (u.country) set.add(u.country);
    });
    return Array.from(set).sort();
  }, [users]);

  const filtered = useMemo(() => {
    let list = [...users];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (u) =>
          u.full_name?.toLowerCase().includes(q) ||
          u.email_contact?.toLowerCase().includes(q) ||
          u.referral_code?.toLowerCase().includes(q)
      );
    }
    if (countryFilter !== "all") list = list.filter((u) => u.country === countryFilter);
    if (levelFilter !== "all") {
      const key = `level_${levelFilter}_count` as keyof NetworkUser;
      list = list.filter((u) => (u[key] as number) > 0);
    }
    return list;
  }, [users, search, countryFilter, levelFilter]);

  const totalPeople = filtered.length;
  const totalMembers = filtered.reduce((sum, u) => sum + u.total_network, 0);
  const avgNetwork = totalPeople > 0 ? (totalMembers / totalPeople).toFixed(1) : "0";

  let dn: Intl.DisplayNames | null = null;
  try {
    dn = new Intl.DisplayNames(["pt"], { type: "region" });
  } catch {}

  const countryLabel = (code: string | null) => {
    if (!code) return "—";
    if (code.length === 2) return dn?.of(code) || code;
    return code;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Rede de Indicações</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Visualização dos usuários pelo tamanho da rede de referral
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="admin-icon-box h-11 w-11 bg-primary text-primary-foreground">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Com rede</p>
              <p className="text-2xl font-bold">{totalPeople}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="admin-icon-box h-11 w-11 bg-primary text-primary-foreground">
              <Network className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Membros totais</p>
              <p className="text-2xl font-bold">{totalMembers}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="admin-icon-box h-11 w-11 bg-primary text-primary-foreground">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Média por rede</p>
              <p className="text-2xl font-bold">{avgNetwork}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome, email ou código..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={countryFilter} onValueChange={setCountryFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="País" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os países</SelectItem>
            {countries.map((c) => (
              <SelectItem key={c} value={c}>{countryLabel(c)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={levelFilter} onValueChange={setLevelFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Nível" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os níveis</SelectItem>
            <SelectItem value="1">Nível 1</SelectItem>
            <SelectItem value="2">Nível 2</SelectItem>
            <SelectItem value="3">Nível 3</SelectItem>
            <SelectItem value="4">Nível 4</SelectItem>
            <SelectItem value="5">Nível 5</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Accordion list */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground">
              Nenhum usuário com rede de indicações encontrado.
            </div>
          ) : (
            <>
              {/* Header */}
              <div
                className="grid items-center gap-3 px-4 py-2 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                style={{ gridTemplateColumns: "2rem 1fr 6rem 5rem repeat(5,3rem) 3.5rem 3.5rem 2rem" }}
              >
                <span>#</span>
                <span>Usuário</span>
                <span>País</span>
                <span>Código</span>
                <span className="text-center">N1</span>
                <span className="text-center">N2</span>
                <span className="text-center">N3</span>
                <span className="text-center">N4</span>
                <span className="text-center">N5</span>
                <span className="text-center">Total</span>
                <span className="text-center">
                  <Mic className="h-3 w-3 mx-auto" />
                </span>
                <span></span>
              </div>
              {filtered.map((u, i) => (
                <NetworkAccordionRow key={u.user_id} user={u} index={i} countryLabel={countryLabel} />
              ))}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
