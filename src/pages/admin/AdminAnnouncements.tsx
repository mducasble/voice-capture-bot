import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Trash2, ToggleLeft, ToggleRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

interface Announcement {
  id: string;
  title: string;
  message: string | null;
  link_url: string | null;
  link_label: string | null;
  announcement_type: string;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
  created_by: string | null;
}

export default function AdminAnnouncements() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ["admin-announcements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("announcements")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Announcement[];
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("announcements")
        .update({ is_active } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-announcements"] });
      queryClient.invalidateQueries({ queryKey: ["announcements"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("announcements")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-announcements"] });
      queryClient.invalidateQueries({ queryKey: ["announcements"] });
      toast.success("Anúncio removido");
    },
  });

  const typeLabels: Record<string, string> = {
    info: "ℹ️ Info",
    warning: "⚠️ Alerta",
    success: "✅ Sucesso",
    promo: "📣 Promoção",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Anúncios</h1>
          <p className="text-sm text-muted-foreground">Mensagens exibidas para todos os usuários logados</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4 mr-2" />
          Novo Anúncio
        </Button>
      </div>

      {showForm && (
        <AnnouncementForm
          onDone={() => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ["admin-announcements"] });
            queryClient.invalidateQueries({ queryKey: ["announcements"] });
          }}
        />
      )}

      {isLoading ? (
        <p className="text-muted-foreground text-sm">Carregando...</p>
      ) : announcements.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nenhum anúncio criado.</p>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <div
              key={a.id}
              className="border rounded-lg p-4 flex items-start gap-4"
              style={{ opacity: a.is_active ? 1 : 0.5 }}
            >
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted font-mono">
                    {typeLabels[a.announcement_type] || a.announcement_type}
                  </span>
                  <span className="font-semibold">{a.title}</span>
                  {!a.is_active && (
                    <span className="text-xs text-muted-foreground">(inativo)</span>
                  )}
                </div>
                {a.message && <p className="text-sm text-muted-foreground">{a.message}</p>}
                {a.link_url && (
                  <a
                    href={a.link_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary inline-flex items-center gap-1"
                  >
                    {a.link_label || a.link_url} <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>Criado: {new Date(a.created_at).toLocaleDateString("pt-BR")}</span>
                  {a.expires_at && (
                    <span>Expira: {new Date(a.expires_at).toLocaleDateString("pt-BR")}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => toggleMutation.mutate({ id: a.id, is_active: !a.is_active })}
                  title={a.is_active ? "Desativar" : "Ativar"}
                >
                  {a.is_active ? (
                    <ToggleRight className="h-5 w-5 text-green-500" />
                  ) : (
                    <ToggleLeft className="h-5 w-5" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    if (confirm("Remover este anúncio?")) deleteMutation.mutate(a.id);
                  }}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AnnouncementForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [type, setType] = useState("info");
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("announcements").insert({
        title: title.trim(),
        message: message.trim() || null,
        link_url: linkUrl.trim() || null,
        link_label: linkLabel.trim() || null,
        announcement_type: type,
        expires_at: expiresAt || null,
        is_active: true,
      } as any);
      if (error) throw error;
      toast.success("Anúncio criado!");
      onDone();
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar anúncio");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border rounded-lg p-4 space-y-4 bg-muted/30">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-xs font-medium">Título *</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Nova campanha disponível!" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Tipo</label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="info">ℹ️ Info</SelectItem>
              <SelectItem value="warning">⚠️ Alerta</SelectItem>
              <SelectItem value="success">✅ Sucesso</SelectItem>
              <SelectItem value="promo">📣 Promoção</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium">Mensagem (opcional)</label>
        <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} placeholder="Detalhes do anúncio..." />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1">
          <label className="text-xs font-medium">Link URL (opcional)</label>
          <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://..." />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Texto do link</label>
          <Input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Ver mais" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Expira em (opcional)</label>
          <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !title.trim()}>
          {saving ? "Salvando..." : "Criar Anúncio"}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>Cancelar</Button>
      </div>
    </form>
  );
}
