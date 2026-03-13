import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, Users, Network, TrendingUp } from "lucide-react";

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

    if (countryFilter !== "all") {
      list = list.filter((u) => u.country === countryFilter);
    }

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
          <Input
            placeholder="Buscar por nome, email ou código..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={countryFilter} onValueChange={setCountryFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="País" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os países</SelectItem>
            {countries.map((c) => (
              <SelectItem key={c} value={c}>
                {countryLabel(c)}
              </SelectItem>
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

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground">
              Carregando...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground">
              Nenhum usuário com rede de indicações encontrado.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Usuário</TableHead>
                  <TableHead>País</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead className="text-center">N1</TableHead>
                  <TableHead className="text-center">N2</TableHead>
                  <TableHead className="text-center">N3</TableHead>
                  <TableHead className="text-center">N4</TableHead>
                  <TableHead className="text-center">N5</TableHead>
                  <TableHead className="text-center">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u, i) => (
                  <TableRow key={u.user_id}>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {i + 1}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium truncate max-w-[200px]">
                          {u.full_name || "—"}
                        </span>
                        {u.email_contact && (
                          <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                            {u.email_contact}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{countryLabel(u.country)}</span>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {u.referral_code || "—"}
                      </code>
                    </TableCell>
                    <TableCell className="text-center">
                      {u.level_1_count > 0 ? (
                        <Badge variant="secondary">{u.level_1_count}</Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {u.level_2_count > 0 ? (
                        <Badge variant="secondary">{u.level_2_count}</Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {u.level_3_count > 0 ? (
                        <Badge variant="secondary">{u.level_3_count}</Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {u.level_4_count > 0 ? (
                        <Badge variant="secondary">{u.level_4_count}</Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {u.level_5_count > 0 ? (
                        <Badge variant="secondary">{u.level_5_count}</Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className="bg-primary text-primary-foreground">
                        {u.total_network}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
