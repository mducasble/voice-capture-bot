import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Inbox, MessageSquare, ChevronLeft, Send, Loader2, CheckCheck, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

/* ─── Types ─── */
interface Thread {
  id: string;
  subject: string;
  category: string;
  status: string;
  last_message_at: string;
  created_at: string;
  unread_count: number;
}

interface Message {
  id: string;
  thread_id: string;
  sender_id: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

/* ─── Main Component ─── */
export default function PortalInbox() {
  const { user } = useAuth();
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  if (!user) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Inbox className="h-6 w-6" style={{ color: "var(--portal-accent)" }} />
        <h1 className="text-2xl font-black uppercase tracking-wider" style={{ color: "var(--portal-text)" }}>
          Mensagens
        </h1>
      </div>

      {selectedThreadId ? (
        <ThreadView
          threadId={selectedThreadId}
          userId={user.id}
          onBack={() => setSelectedThreadId(null)}
        />
      ) : (
        <ThreadList
          userId={user.id}
          onSelectThread={setSelectedThreadId}
        />
      )}
    </div>
  );
}

/* ─── Thread List ─── */
function ThreadList({ userId, onSelectThread }: { userId: string; onSelectThread: (id: string) => void }) {
  const [showNewThread, setShowNewThread] = useState(false);
  const queryClient = useQueryClient();

  const { data: threads = [], isLoading } = useQuery({
    queryKey: ["portal-inbox-threads", userId],
    queryFn: async () => {
      const { data: threadRows, error } = await supabase
        .from("inbox_threads" as any)
        .select("id, subject, category, status, last_message_at, created_at")
        .eq("user_id", userId)
        .order("last_message_at", { ascending: false });
      if (error) throw error;
      if (!threadRows?.length) return [];

      // Count unread messages per thread
      const threadIds = (threadRows as any[]).map((t: any) => t.id);
      const { data: unreadData } = await supabase
        .from("inbox_messages" as any)
        .select("thread_id")
        .in("thread_id", threadIds)
        .eq("is_read", false)
        .neq("sender_id", userId);

      const unreadMap = new Map<string, number>();
      for (const u of (unreadData || []) as any[]) {
        unreadMap.set(u.thread_id, (unreadMap.get(u.thread_id) || 0) + 1);
      }

      return (threadRows as any[]).map((t: any) => ({
        ...t,
        unread_count: unreadMap.get(t.id) || 0,
      })) as Thread[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async ({ subject, body }: { subject: string; body: string }) => {
      // Create thread
      const { data: thread, error: tErr } = await supabase
        .from("inbox_threads" as any)
        .insert({
          user_id: userId,
          subject,
          category: "support",
          created_by: userId,
        } as any)
        .select("id")
        .single();
      if (tErr) throw tErr;

      // Create first message
      const { error: mErr } = await supabase
        .from("inbox_messages" as any)
        .insert({
          thread_id: (thread as any).id,
          sender_id: userId,
          body,
        } as any);
      if (mErr) throw mErr;

      return (thread as any).id;
    },
    onSuccess: (threadId) => {
      toast.success("Mensagem enviada!");
      queryClient.invalidateQueries({ queryKey: ["portal-inbox-threads"] });
      setShowNewThread(false);
      onSelectThread(threadId);
    },
    onError: () => toast.error("Erro ao enviar mensagem"),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--portal-text-muted)" }} />
      </div>
    );
  }

  if (showNewThread) {
    return <NewThreadForm onSubmit={(s, b) => createMutation.mutate({ subject: s, body: b })} onCancel={() => setShowNewThread(false)} isPending={createMutation.isPending} />;
  }

  return (
    <div className="space-y-4">
      <Button
        onClick={() => setShowNewThread(true)}
        className="font-mono text-xs uppercase tracking-widest"
        style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}
      >
        <MessageSquare className="h-4 w-4 mr-2" />
        Nova Mensagem
      </Button>

      {threads.length === 0 ? (
        <div className="text-center py-16">
          <Inbox className="h-12 w-12 mx-auto mb-4" style={{ color: "var(--portal-text-muted)", opacity: 0.3 }} />
          <p className="font-mono text-sm" style={{ color: "var(--portal-text-muted)" }}>
            Nenhuma mensagem ainda
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((thread) => (
            <button
              key={thread.id}
              onClick={() => onSelectThread(thread.id)}
              className="w-full text-left p-4 transition-all"
              style={{
                border: "1px solid var(--portal-border)",
                background: thread.unread_count > 0 ? "var(--portal-accent-bg, rgba(0,255,136,0.05))" : "transparent",
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {thread.unread_count > 0 && (
                      <Circle className="h-2.5 w-2.5 fill-current shrink-0" style={{ color: "var(--portal-accent)" }} />
                    )}
                    <p className="font-mono text-sm font-bold truncate" style={{ color: "var(--portal-text)" }}>
                      {thread.subject}
                    </p>
                  </div>
                  <p className="font-mono text-xs mt-1" style={{ color: "var(--portal-text-muted)" }}>
                    {thread.category === "support" ? "Suporte" : thread.category === "payment" ? "Pagamento" : "Geral"}
                    {" · "}
                    {thread.status === "open" ? "Aberto" : "Fechado"}
                  </p>
                </div>
                <span className="font-mono text-xs shrink-0" style={{ color: "var(--portal-text-muted)" }}>
                  {new Date(thread.last_message_at).toLocaleDateString("pt-BR")}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── New Thread Form ─── */
function NewThreadForm({ onSubmit, onCancel, isPending }: { onSubmit: (subject: string, body: string) => void; onCancel: () => void; isPending: boolean }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  return (
    <div className="space-y-4">
      <button
        onClick={onCancel}
        className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest"
        style={{ color: "var(--portal-text-muted)" }}
      >
        <ChevronLeft className="h-4 w-4" />
        Voltar
      </button>

      <div className="p-6 space-y-4" style={{ border: "1px solid var(--portal-border)" }}>
        <Input
          placeholder="Assunto"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="font-mono text-sm bg-transparent border-0 border-b px-0 rounded-none focus-visible:ring-0"
          style={{ borderColor: "var(--portal-border)", color: "var(--portal-text)" }}
        />
        <Textarea
          placeholder="Escreva sua mensagem..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          className="font-mono text-sm bg-transparent border-0 px-0 rounded-none focus-visible:ring-0 resize-none"
          style={{ color: "var(--portal-text)" }}
        />
        <div className="flex justify-end">
          <Button
            onClick={() => onSubmit(subject, body)}
            disabled={!subject.trim() || !body.trim() || isPending}
            className="font-mono text-xs uppercase tracking-widest"
            style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            Enviar
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── Thread View ─── */
function ThreadView({ threadId, userId, onBack }: { threadId: string; userId: string; onBack: () => void }) {
  const [reply, setReply] = useState("");
  const queryClient = useQueryClient();

  const { data: thread } = useQuery({
    queryKey: ["portal-inbox-thread", threadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inbox_threads" as any)
        .select("id, subject, category, status, created_at")
        .eq("id", threadId)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["portal-inbox-messages", threadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inbox_messages" as any)
        .select("id, sender_id, body, is_read, created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });
      if (error) throw error;

      // Mark unread messages as read
      const unreadIds = ((data || []) as any[])
        .filter((m: any) => !m.is_read && m.sender_id !== userId)
        .map((m: any) => m.id);
      if (unreadIds.length > 0) {
        await supabase
          .from("inbox_messages" as any)
          .update({ is_read: true } as any)
          .in("id", unreadIds);
      }

      return (data || []) as unknown as Message[];
    },
  });

  const replyMutation = useMutation({
    mutationFn: async (body: string) => {
      const { error: mErr } = await supabase
        .from("inbox_messages" as any)
        .insert({
          thread_id: threadId,
          sender_id: userId,
          body,
        } as any);
      if (mErr) throw mErr;

      // Update last_message_at
      await supabase
        .from("inbox_threads" as any)
        .update({ last_message_at: new Date().toISOString() } as any)
        .eq("id", threadId);
    },
    onSuccess: () => {
      setReply("");
      queryClient.invalidateQueries({ queryKey: ["portal-inbox-messages", threadId] });
      queryClient.invalidateQueries({ queryKey: ["portal-inbox-threads"] });
    },
    onError: () => toast.error("Erro ao enviar resposta"),
  });

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest"
        style={{ color: "var(--portal-text-muted)" }}
      >
        <ChevronLeft className="h-4 w-4" />
        Voltar
      </button>

      {thread && (
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-lg font-bold" style={{ color: "var(--portal-text)" }}>
            {(thread as any).subject}
          </h2>
          <span
            className="font-mono text-xs px-2 py-1"
            style={{
              border: "1px solid var(--portal-border)",
              color: "var(--portal-text-muted)",
            }}
          >
            {(thread as any).status === "open" ? "Aberto" : "Fechado"}
          </span>
        </div>
      )}

      {/* Messages */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--portal-text-muted)" }} />
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.sender_id === userId;
            return (
              <div
                key={msg.id}
                className="p-4"
                style={{
                  border: "1px solid var(--portal-border)",
                  background: isMe ? "transparent" : "var(--portal-accent-bg, rgba(0,255,136,0.03))",
                  borderLeft: isMe ? "1px solid var(--portal-border)" : "3px solid var(--portal-accent)",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs font-bold" style={{ color: isMe ? "var(--portal-text-muted)" : "var(--portal-accent)" }}>
                    {isMe ? "Você" : "Equipe KGeN"}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
                      {new Date(msg.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {isMe && msg.is_read && (
                      <CheckCheck className="h-3.5 w-3.5" style={{ color: "var(--portal-accent)" }} />
                    )}
                  </div>
                </div>
                <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--portal-text)" }}>
                  {msg.body}
                </p>
              </div>
            );
          })
        )}
      </div>

      {/* Reply */}
      {thread && (thread as any).status === "open" && (
        <div className="flex gap-3">
          <Textarea
            placeholder="Responder..."
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={2}
            className="flex-1 font-mono text-sm bg-transparent resize-none"
            style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text)" }}
          />
          <Button
            onClick={() => reply.trim() && replyMutation.mutate(reply.trim())}
            disabled={!reply.trim() || replyMutation.isPending}
            className="self-end"
            style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}
          >
            {replyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      )}
    </div>
  );
}
