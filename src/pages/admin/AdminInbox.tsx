import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import {
  Inbox, Send, Loader2, ChevronDown, ChevronRight, Search,
  RefreshCw, Circle, CheckCheck, MessageSquarePlus, Users, FileText,
  ShieldCheck, Megaphone, Globe, FolderOpen,
} from "lucide-react";
import InboxTemplateManager from "@/components/admin/InboxTemplateManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CampaignSelector } from "@/components/CampaignSelector";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* ─── Types ─── */
interface AdminThread {
  id: string;
  user_id: string;
  subject: string;
  category: string;
  status: string;
  last_message_at: string;
  created_at: string;
  full_name: string | null;
  unread_count: number;
}

interface AdminMessage {
  id: string;
  thread_id: string;
  sender_id: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

/* ─── Component ─── */
export default function AdminInbox() {
  const { user } = useAdminAuth();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedThread, setExpandedThread] = useState<string | null>(null);
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [verifyingWalletThread, setVerifyingWalletThread] = useState<string | null>(null);
  const [showBroadcast, setShowBroadcast] = useState(false);

  /* ─── Verify wallet (thread context) ─── */
  const handleVerifyWalletThread = async (userId: string, threadId: string) => {
    setVerifyingWalletThread(threadId);
    try {
      const { error } = await supabase.functions.invoke("admin-update-user", {
        body: { action: "update_profile", user_id: userId, profile_data: { wallet_verified: true } },
      });
      if (error) throw error;
      toast.success("Carteira marcada como verificada!");
    } catch (e: any) {
      toast.error("Erro ao verificar carteira: " + (e.message || "erro desconhecido"));
    } finally {
      setVerifyingWalletThread(null);
    }
  };

  /* ─── Fetch threads ─── */
  const { data: threads = [], isLoading, refetch } = useQuery({
    queryKey: ["admin-inbox-threads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inbox_threads" as any)
        .select("id, user_id, subject, category, status, last_message_at, created_at")
        .order("last_message_at", { ascending: false });
      if (error) throw error;
      if (!data?.length) return [];

      const userIds = [...new Set((data as any[]).map((t: any) => t.user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds);
      const profileMap = new Map((profiles || []).map(p => [p.id, p.full_name]));

      // Count unread (messages not from admin)
      const threadIds = (data as any[]).map((t: any) => t.id);
      const { data: unreadData } = await supabase
        .from("inbox_messages" as any)
        .select("thread_id, sender_id")
        .in("thread_id", threadIds)
        .eq("is_read", false);

      const unreadMap = new Map<string, number>();
      for (const u of (unreadData || []) as any[]) {
        // Count messages from users (not admin)
        const thread = (data as any[]).find((t: any) => t.id === u.thread_id);
        if (thread && u.sender_id === (thread as any).user_id) {
          unreadMap.set(u.thread_id, (unreadMap.get(u.thread_id) || 0) + 1);
        }
      }

      return (data as any[]).map((t: any) => ({
        ...t,
        full_name: profileMap.get(t.user_id) || null,
        unread_count: unreadMap.get(t.id) || 0,
      })) as AdminThread[];
    },
  });

  /* ─── Fetch messages for expanded thread ─── */
  const { data: threadMessages = [] } = useQuery({
    queryKey: ["admin-inbox-messages", expandedThread],
    enabled: !!expandedThread,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inbox_messages" as any)
        .select("id, thread_id, sender_id, body, is_read, created_at")
        .eq("thread_id", expandedThread!)
        .order("created_at", { ascending: true });
      if (error) throw error;

      // Mark user messages as read
      const thread = threads.find(t => t.id === expandedThread);
      const unreadIds = ((data || []) as any[])
        .filter((m: any) => !m.is_read && thread && m.sender_id === thread.user_id)
        .map((m: any) => m.id);
      if (unreadIds.length > 0) {
        await supabase
          .from("inbox_messages" as any)
          .update({ is_read: true } as any)
          .in("id", unreadIds);
        queryClient.invalidateQueries({ queryKey: ["admin-inbox-threads"] });
      }

      return (data || []) as unknown as AdminMessage[];
    },
  });

  /* ─── Reply mutation ─── */
  const replyMutation = useMutation({
    mutationFn: async ({ threadId, body }: { threadId: string; body: string }) => {
      if (!user) throw new Error("Not authenticated");
      const { error: mErr } = await supabase
        .from("inbox_messages" as any)
        .insert({ thread_id: threadId, sender_id: user.id, body } as any);
      if (mErr) throw mErr;

      await supabase
        .from("inbox_threads" as any)
        .update({ last_message_at: new Date().toISOString() } as any)
        .eq("id", threadId);
    },
    onSuccess: (_, vars) => {
      setReplyText(prev => ({ ...prev, [vars.threadId]: "" }));
      queryClient.invalidateQueries({ queryKey: ["admin-inbox-messages", vars.threadId] });
      queryClient.invalidateQueries({ queryKey: ["admin-inbox-threads"] });
      toast.success("Resposta enviada!");
    },
    onError: () => toast.error("Erro ao enviar resposta"),
  });

  /* ─── New message to user ─── */
  const sendMutation = useMutation({
    mutationFn: async ({ userId, subject, body, category }: { userId: string; subject: string; body: string; category: string }) => {
      if (!user) throw new Error("Not authenticated");
      const { data: thread, error: tErr } = await supabase
        .from("inbox_threads" as any)
        .insert({ user_id: userId, subject, category, created_by: user.id } as any)
        .select("id")
        .single();
      if (tErr) throw tErr;

      const { error: mErr } = await supabase
        .from("inbox_messages" as any)
        .insert({ thread_id: (thread as any).id, sender_id: user.id, body } as any);
      if (mErr) throw mErr;
    },
    onSuccess: () => {
      toast.success("Mensagem enviada!");
      setShowNewMessage(false);
      queryClient.invalidateQueries({ queryKey: ["admin-inbox-threads"] });
    },
    onError: () => toast.error("Erro ao enviar mensagem"),
  });

  /* ─── Filter ─── */
  const filtered = threads.filter(t => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return t.full_name?.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q);
  });

  const openCount = threads.filter(t => t.status === "open").length;
  const unreadTotal = threads.reduce((s, t) => s + t.unread_count, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground">Inbox</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {openCount} conversas abertas · {unreadTotal} não lidas
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowNewMessage(true)}>
            <MessageSquarePlus className="h-4 w-4 mr-2" />
            Nova Mensagem
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Atualizar
          </Button>
        </div>
      </div>

      {/* New message form */}
      {showNewMessage && (
        <NewAdminMessage
          onSend={(userId, subject, body, category) => sendMutation.mutate({ userId, subject, body, category })}
          onCancel={() => setShowNewMessage(false)}
          isPending={sendMutation.isPending}
        />
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome ou assunto..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Template Manager */}
      <InboxTemplateManager />

      {/* Threads */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Inbox className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Nenhuma conversa encontrada</p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          {filtered.map(thread => {
            const isExpanded = expandedThread === thread.id;
            return (
              <div key={thread.id} className="border-b last:border-0">
                {/* Thread row */}
                <button
                  onClick={() => setExpandedThread(isExpanded ? null : thread.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/10 transition-colors text-left"
                >
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                  {thread.unread_count > 0 && (
                    <Circle className="h-2.5 w-2.5 fill-primary text-primary shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-sm truncate", thread.unread_count > 0 ? "font-bold text-foreground" : "text-foreground")}>
                        {thread.full_name || "Sem nome"}
                      </span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground truncate">{thread.subject}</span>
                    </div>
                  </div>
                  <span className={cn("text-xs px-2 py-0.5 rounded-full border", thread.status === "open" ? "border-emerald-500/30 text-emerald-400" : "border-muted text-muted-foreground")}>
                    {thread.status === "open" ? "Aberto" : "Fechado"}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(thread.last_message_at).toLocaleDateString("pt-BR")}
                  </span>
                </button>

                {/* Expanded: messages + reply */}
                {isExpanded && (
                  <div className="px-6 pb-4 bg-muted/5 space-y-3">
                    {threadMessages.map((msg) => {
                      const isUser = msg.sender_id === thread.user_id;
                      return (
                        <div
                          key={msg.id}
                          className={cn("p-3 rounded-lg text-sm", isUser ? "bg-muted/20 border border-border" : "bg-primary/5 border border-primary/20")}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className={cn("text-xs font-semibold", isUser ? "text-foreground" : "text-primary")}>
                              {isUser ? thread.full_name || "Usuário" : "Admin"}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-muted-foreground">
                                {new Date(msg.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                              </span>
                              {!isUser && msg.is_read && <CheckCheck className="h-3 w-3 text-primary" />}
                            </div>
                          </div>
                          <p className="text-foreground whitespace-pre-wrap">{msg.body}</p>
                        </div>
                      );
                    })}

                    {/* Verify wallet button for wallet test threads */}
                    {thread.subject.toLowerCase().includes("wallet") && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleVerifyWalletThread(thread.user_id, thread.id)}
                        disabled={verifyingWalletThread === thread.id}
                        className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                      >
                        {verifyingWalletThread === thread.id ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                        Confirmo o recebimento do teste
                      </Button>
                    )}

                    {/* Reply */}
                    {thread.status === "open" && (
                      <div className="flex gap-2 pt-2">
                        <Textarea
                          placeholder="Responder..."
                          value={replyText[thread.id] || ""}
                          onChange={(e) => setReplyText(prev => ({ ...prev, [thread.id]: e.target.value }))}
                          rows={2}
                          className="flex-1 text-sm resize-none"
                        />
                        <Button
                          size="sm"
                          onClick={() => {
                            const text = (replyText[thread.id] || "").trim();
                            if (text) replyMutation.mutate({ threadId: thread.id, body: text });
                          }}
                          disabled={!(replyText[thread.id] || "").trim() || replyMutation.isPending}
                          className="self-end"
                        >
                          {replyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── New Message Form ─── */
function NewAdminMessage({ onSend, onCancel, isPending }: {
  onSend: (userId: string, subject: string, body: string, category: string) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [userSearch, setUserSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<{ id: string; name: string } | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("general");
  const [activeTemplateKey, setActiveTemplateKey] = useState<string | null>(null);
  const [verifyingWallet, setVerifyingWallet] = useState(false);

  /* ─── Verify wallet ─── */
  const handleVerifyWallet = async (userId: string) => {
    setVerifyingWallet(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-update-user", {
        body: { action: "update_profile", user_id: userId, profile_data: { wallet_verified: true } },
      });
      if (error) throw error;
      toast.success("Carteira marcada como verificada!");
    } catch (e: any) {
      toast.error("Erro ao verificar carteira: " + (e.message || "erro desconhecido"));
    } finally {
      setVerifyingWallet(false);
    }
  };

  /* ─── Templates ─── */
  const { data: templates = [] } = useQuery({
    queryKey: ["admin-inbox-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inbox_message_templates" as any)
        .select("id, template_key, subject, category, body")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const applyTemplate = (templateKey: string) => {
    const tpl = templates.find((t: any) => t.template_key === templateKey);
    if (tpl) {
      setSubject(tpl.subject);
      setBody(tpl.body);
      setCategory(tpl.category);
      setActiveTemplateKey(templateKey);
    }
  };

  const { data: users = [] } = useQuery({
    queryKey: ["admin-inbox-user-search", userSearch],
    enabled: userSearch.length >= 2,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name")
        .ilike("full_name", `%${userSearch}%`)
        .limit(10);
      return (data || []).map(u => ({ id: u.id, name: u.full_name || "Sem nome" }));
    },
  });

  const templateLabels: Record<string, string> = {
    welcome: "🎉 Boas-vindas",
    wallet_test_tx: "💰 Transação de teste",
  };

  return (
    <div className="rounded-xl border p-5 space-y-4 bg-muted/5">
      <h3 className="text-sm font-bold text-foreground">Nova Mensagem</h3>

      {/* Templates */}
      {templates.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Templates
          </span>
          <div className="flex flex-wrap gap-2">
            {templates.map((tpl: any) => (
              <button
                key={tpl.id}
                onClick={() => applyTemplate(tpl.template_key)}
                className="text-xs px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5 transition-colors"
              >
                {templateLabels[tpl.template_key] || tpl.subject}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* User search */}
      {!selectedUser ? (
        <div className="space-y-2">
          <div className="relative">
            <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar usuário por nome..."
              value={userSearch}
              onChange={e => setUserSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          {users.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              {users.map(u => (
                <button
                  key={u.id}
                  onClick={() => setSelectedUser(u)}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-muted/20 transition-colors border-b last:border-0 text-foreground"
                >
                  {u.name}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-sm text-foreground">Para: <strong>{selectedUser.name}</strong></span>
          <button onClick={() => setSelectedUser(null)} className="text-xs text-muted-foreground hover:text-foreground">(trocar)</button>
        </div>
      )}

      {/* Category */}
      <div className="flex gap-2">
        {[
          { value: "general", label: "Geral" },
          { value: "payment", label: "Pagamento" },
          { value: "support", label: "Suporte" },
        ].map(c => (
          <button
            key={c.value}
            onClick={() => setCategory(c.value)}
            className={cn("text-xs px-3 py-1.5 rounded-full border transition-colors", category === c.value ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground")}
          >
            {c.label}
          </button>
        ))}
      </div>

      <Input placeholder="Assunto" value={subject} onChange={e => setSubject(e.target.value)} />
      <Textarea placeholder="Mensagem..." value={body} onChange={e => setBody(e.target.value)} rows={4} className="resize-none" />

      <div className="flex items-center justify-end gap-2">
        {activeTemplateKey === "wallet_test_tx" && selectedUser && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleVerifyWallet(selectedUser.id)}
            disabled={verifyingWallet}
            className="mr-auto border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
          >
            {verifyingWallet ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
            Confirmo o recebimento do teste
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button>
        <Button
          size="sm"
          onClick={() => selectedUser && onSend(selectedUser.id, subject, body, category)}
          disabled={!selectedUser || !subject.trim() || !body.trim() || isPending}
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
          Enviar
        </Button>
      </div>
    </div>
  );
}
