import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Search, ChevronDown, ChevronUp, Edit2, KeyRound, X, Check, Loader2, Mail, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import CountrySelect from "@/components/portal/CountrySelect";

interface Profile {
  id: string;
  full_name: string | null;
  email_contact: string | null;
  country: string | null;
  city: string | null;
  whatsapp: string | null;
  telegram: string | null;
  spoken_languages: string[] | null;
  created_at: string;
  referral_code: string | null;
}

type SortKey = "full_name" | "country" | "created_at";

function useAllProfiles() {
  return useQuery({
    queryKey: ["admin-all-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email_contact, country, city, whatsapp, telegram, spoken_languages, created_at, referral_code")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Profile[];
    },
  });
}

function useUserEmails(userIds: string[]) {
  return useQuery({
    queryKey: ["admin-user-emails", userIds.length],
    queryFn: async () => {
      if (userIds.length === 0) return {};
      const { data: { session } } = await supabase.auth.getSession();
      const map: Record<string, string> = {};

      // Fetch emails in batches of 20
      for (let i = 0; i < userIds.length; i += 20) {
        const batch = userIds.slice(i, i + 20);
        const results = await Promise.all(
          batch.map(async (uid) => {
            try {
              const res = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-update-user`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session?.access_token}`,
                  },
                  body: JSON.stringify({ action: "get_user_email", user_id: uid }),
                }
              );
              if (res.ok) {
                const data = await res.json();
                return { uid, email: data.email };
              }
            } catch {}
            return { uid, email: null };
          })
        );
        results.forEach(({ uid, email }) => { if (email) map[uid] = email; });
      }
      return map;
    },
    enabled: userIds.length > 0,
    staleTime: 300_000,
  });
}

export default function AdminUsers() {
  const { data: profiles = [], isLoading } = useAllProfiles();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [editProfile, setEditProfile] = useState<Profile | null>(null);
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const userIds = useMemo(() => profiles.map(p => p.id), [profiles]);
  const { data: emailMap = {} } = useUserEmails(userIds);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let list = profiles.filter(p =>
      !q ||
      p.full_name?.toLowerCase().includes(q) ||
      p.email_contact?.toLowerCase().includes(q) ||
      p.country?.toLowerCase().includes(q) ||
      p.city?.toLowerCase().includes(q) ||
      p.referral_code?.toLowerCase().includes(q) ||
      emailMap[p.id]?.toLowerCase().includes(q)
    );
    list.sort((a, b) => {
      const va = (a[sortKey] || "") as string;
      const vb = (b[sortKey] || "") as string;
      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    return list;
  }, [profiles, search, sortKey, sortAsc, emailMap]);

  const updateProfileMutation = useMutation({
    mutationFn: async (data: { user_id: string; profile_data: Partial<Profile> }) => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-update-user`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ action: "update_profile", ...data }),
        }
      );
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-all-profiles"] });
      toast.success("Perfil atualizado");
      setEditProfile(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (data: { user_id: string; new_password?: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-update-user`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ action: "reset_password", ...data }),
        }
      );
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.method === "email") toast.success("Email de redefinição enviado");
      else toast.success("Senha alterada com sucesso");
      setResetUserId(null);
      setNewPassword("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null;
    return sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />;
  };

  const countryName = (code: string | null) => {
    if (!code) return "—";
    try {
      const dn = new Intl.DisplayNames(["pt"], { type: "region" });
      return dn.of(code) || code;
    } catch { return code; }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Usuários</h1>
          <p className="text-muted-foreground text-xs mt-1">{profiles.length} cadastrados</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome, email, país, código..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-10 bg-secondary border-border/40"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border/40 bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40 text-left">
              <th className="px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort("full_name")}>
                <span className="flex items-center gap-1">Nome <SortIcon col="full_name" /></span>
              </th>
              <th className="px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Email</th>
              <th className="px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort("country")}>
                <span className="flex items-center gap-1">País <SortIcon col="country" /></span>
              </th>
              <th className="px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Cidade</th>
              <th className="px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Contato</th>
              <th className="px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort("created_at")}>
                <span className="flex items-center gap-1">Cadastro <SortIcon col="created_at" /></span>
              </th>
              <th className="px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="text-center py-12"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">Nenhum usuário encontrado</td></tr>
            ) : (
              filtered.map(p => (
                <tr key={p.id} className="border-b border-border/20 hover:bg-secondary/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{p.full_name || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{emailMap[p.id] || p.email_contact || "—"}</td>
                  <td className="px-4 py-3 text-foreground">{countryName(p.country)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.city || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {p.whatsapp && <span title="WhatsApp">📱</span>}
                      {p.telegram && <span title="Telegram">✈️</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {format(new Date(p.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setEditProfile(p)}
                        className="p-1.5 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                        title="Editar perfil"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setResetUserId(p.id)}
                        className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        title="Resetar senha"
                      >
                        <KeyRound className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Edit Dialog */}
      <EditProfileDialog
        profile={editProfile}
        onClose={() => setEditProfile(null)}
        onSave={(data) => editProfile && updateProfileMutation.mutate({ user_id: editProfile.id, profile_data: data })}
        saving={updateProfileMutation.isPending}
      />

      {/* Reset Password Dialog */}
      <Dialog open={!!resetUserId} onOpenChange={() => { setResetUserId(null); setNewPassword(""); }}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Redefinir Senha</DialogTitle>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Envie um email de redefinição ou defina uma nova senha diretamente.
            </p>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Nova senha (opcional)</label>
              <Input
                type="text"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Deixe vazio para enviar email"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => resetUserId && resetPasswordMutation.mutate({ user_id: resetUserId, new_password: newPassword || undefined })}
                disabled={resetPasswordMutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {resetPasswordMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : newPassword ? <KeyRound className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                {newPassword ? "Alterar Senha" : "Enviar Email"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditProfileDialog({ profile, onClose, onSave, saving }: {
  profile: Profile | null;
  onClose: () => void;
  onSave: (data: Partial<Profile>) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<Partial<Profile>>({});

  // Sync form when profile changes
  const currentProfile = profile;
  const currentForm = currentProfile ? { ...currentProfile, ...form } : null;

  if (!currentForm) return null;

  return (
    <Dialog open={!!profile} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Editar Perfil</DialogTitle>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Nome completo</label>
            <Input value={currentForm.full_name || ""} onChange={e => setForm({ ...form, full_name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">País</label>
              <CountrySelect value={currentForm.country || ""} onValueChange={v => setForm({ ...form, country: v })} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cidade</label>
              <Input value={currentForm.city || ""} onChange={e => setForm({ ...form, city: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">WhatsApp</label>
              <Input value={currentForm.whatsapp || ""} onChange={e => setForm({ ...form, whatsapp: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Telegram</label>
              <Input value={currentForm.telegram || ""} onChange={e => setForm({ ...form, telegram: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email de contato</label>
            <Input value={currentForm.email_contact || ""} onChange={e => setForm({ ...form, email_contact: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors">
              Cancelar
            </button>
            <button
              onClick={() => onSave(form)}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Salvar
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
