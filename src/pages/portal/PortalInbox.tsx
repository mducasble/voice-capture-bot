import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import {
  Inbox,
  MessageSquare,
  Send,
  Loader2,
  CheckCheck,
  Circle,
  Plus,
  ChevronLeft,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { renderFormattedText } from "@/lib/formatInboxMessage";

/* ─── Types ─── */
interface Thread {
  id: string;
  subject: string;
  category: string;
  status: string;
  last_message_at: string;
  created_at: string;
  unread_count: number;
  preview: string;
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
  const { t } = useTranslation();
  const location = useLocation();
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [showNewThread, setShowNewThread] = useState(false);
  const [prefillSubject, setPrefillSubject] = useState("");
  const isMobile = useIsMobile();

  // Handle bug report prefill from navigation state
  useEffect(() => {
    const state = location.state as { bugReport?: boolean; subject?: string } | null;
    if (state?.bugReport && state?.subject) {
      setShowNewThread(true);
      setSelectedThreadId(null);
      setPrefillSubject(state.subject);
      // Clear the state so refreshing doesn't re-trigger
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  if (!user) return null;

  const showList = isMobile ? !selectedThreadId && !showNewThread : true;
  const showConversation = isMobile ? !!selectedThreadId || showNewThread : true;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Inbox className="h-5 w-5" style={{ color: "var(--portal-accent)" }} />
        <h1
          className="text-xl font-black uppercase tracking-wider"
          style={{ color: "var(--portal-text)" }}
        >
          {t("inbox.title")}
        </h1>
      </div>

      <div
        className="flex overflow-hidden rounded"
        style={{
          border: "1px solid rgba(255, 255, 255, 0.025)",
          height: "calc(100vh - 220px)",
          minHeight: "500px",
          background: "rgba(255, 255, 255, 0.03)",
          backdropFilter: "blur(6px)",
        }}
      >
        {/* ── Left column: thread list ── */}
        {showList && (
          <div
            className={cn(
              "flex flex-col shrink-0",
              isMobile ? "w-full" : "w-[380px]"
            )}
            style={{
              borderRight: isMobile ? "none" : "1px solid rgba(255, 255, 255, 0.02)",
              background: "rgba(255, 255, 255, 0.035)",
            }}
          >
            <ThreadList
              userId={user.id}
              selectedThreadId={selectedThreadId}
              onSelectThread={(id) => {
                setSelectedThreadId(id);
                setShowNewThread(false);
              }}
              onNewThread={() => {
                setSelectedThreadId(null);
                setShowNewThread(true);
              }}
            />
          </div>
        )}

        {/* ── Right column: conversation ── */}
        {showConversation && (
          <div className="flex-1 flex flex-col min-w-0">
            {showNewThread ? (
              <NewThreadForm
                userId={user.id}
                onCreated={(id) => {
                  setShowNewThread(false);
                  setSelectedThreadId(id);
                }}
                onBack={() => setShowNewThread(false)}
              />
            ) : selectedThreadId ? (
              <ConversationView
                threadId={selectedThreadId}
                userId={user.id}
                onBack={isMobile ? () => setSelectedThreadId(null) : undefined}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center space-y-3">
                  <MessageSquare
                    className="h-10 w-10 mx-auto"
                    style={{ color: "var(--portal-text-muted)", opacity: 0.5 }}
                  />
                  <p
                    className="font-mono text-sm"
                    style={{ color: "var(--portal-text-muted)" }}
                  >
                    {t("inbox.selectConversation")}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Thread List ─── */
function ThreadList({
  userId,
  selectedThreadId,
  onSelectThread,
  onNewThread,
}: {
  userId: string;
  selectedThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
}) {
  const { t, i18n } = useTranslation();
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

      const threadIds = (threadRows as any[]).map((t: any) => t.id);

      const [{ data: unreadData }, { data: previewData }] = await Promise.all([
        supabase
          .from("inbox_messages" as any)
          .select("thread_id")
          .in("thread_id", threadIds)
          .eq("is_read", false)
          .neq("sender_id", userId),
        supabase
          .from("inbox_messages" as any)
          .select("thread_id, body")
          .in("thread_id", threadIds)
          .order("created_at", { ascending: true }),
      ]);

      const unreadMap = new Map<string, number>();
      for (const u of (unreadData || []) as any[]) {
        unreadMap.set(u.thread_id, (unreadMap.get(u.thread_id) || 0) + 1);
      }

      // First message per thread as preview
      const previewMap = new Map<string, string>();
      for (const m of (previewData || []) as any[]) {
        if (!previewMap.has(m.thread_id)) {
          previewMap.set(m.thread_id, m.body);
        }
      }

      return (threadRows as any[]).map((t: any) => ({
        ...t,
        unread_count: unreadMap.get(t.id) || 0,
        preview: previewMap.get(t.id) || "",
      })) as Thread[];
    },
  });

  return (
    <>
      {/* Header */}
      <div
        className="p-3 flex items-center justify-between shrink-0"
        style={{ borderBottom: "1px solid var(--portal-border)" }}
      >
        <span
          className="font-mono text-xs uppercase tracking-widest font-bold"
          style={{ color: "var(--portal-text-muted)" }}
        >
          {t("inbox.conversations")}
        </span>
        <button
          onClick={onNewThread}
          className="h-7 w-7 flex items-center justify-center transition-colors hover:opacity-80"
          style={{ color: "var(--portal-accent)" }}
          title={t("inbox.newMessage")}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--portal-text-muted)" }} />
          </div>
        ) : threads.length === 0 ? (
          <div className="text-center py-16 px-4">
            <Inbox
              className="h-8 w-8 mx-auto mb-3"
              style={{ color: "var(--portal-text-muted)", opacity: 0.5 }}
            />
            <p className="font-mono text-sm" style={{ color: "var(--portal-text-muted)" }}>
              {t("inbox.noMessages")}
            </p>
          </div>
        ) : (
          <div>
            {threads.map((thread) => {
              const isSelected = thread.id === selectedThreadId;
              return (
                <button
                  key={thread.id}
                  onClick={() => onSelectThread(thread.id)}
                  className="w-full text-left px-4 py-3 transition-all"
                  style={{
                    borderBottom: "1px solid var(--portal-border)",
                    background: isSelected
                      ? "rgba(140, 255, 5, 0.15)"
                      : thread.unread_count > 0
                        ? "rgba(255, 160, 40, 0.10)"
                        : "rgba(255, 255, 255, 0.03)",
                    borderLeft: isSelected
                      ? "3px solid var(--portal-accent)"
                      : thread.unread_count > 0
                        ? "3px solid rgba(255, 160, 40, 0.8)"
                        : "3px solid transparent",
                  }}
                >
                  <div className="flex items-start gap-2">
                    {thread.unread_count > 0 && (
                      <Circle
                        className="h-2 w-2 fill-current shrink-0 mt-1.5"
                        style={{ color: "rgba(255, 160, 40, 0.9)" }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
                          {thread.category === "support"
                            ? t("inbox.support")
                            : thread.category === "payment"
                              ? t("inbox.payment")
                              : t("inbox.general")}
                        </span>
                        <span className="font-mono text-xs shrink-0 ml-2" style={{ color: "var(--portal-text-muted)" }}>
                          {new Date(thread.last_message_at).toLocaleDateString(i18n.language === "en" ? "en-US" : i18n.language === "es" ? "es-ES" : "pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                          })}
                        </span>
                      </div>
                      <p
                        className="font-mono text-sm font-bold truncate mt-0.5"
                        style={{ color: "var(--portal-text)" }}
                      >
                        {thread.subject}
                      </p>
                      {thread.preview && (
                        <p
                          className="font-mono text-xs mt-2 line-clamp-2"
                          style={{ color: "var(--portal-text-muted)", opacity: 0.7 }}
                        >
                          {thread.preview}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </>
  );
}

/* ─── New Thread Form ─── */
function NewThreadForm({
  userId,
  onCreated,
  onBack,
}: {
  userId: string;
  onCreated: (threadId: string) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async ({ subject, body }: { subject: string; body: string }) => {
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
      toast.success(t("inbox.sent"));
      queryClient.invalidateQueries({ queryKey: ["portal-inbox-threads"] });
      onCreated(threadId);
    },
    onError: () => toast.error(t("inbox.sendError")),
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="p-3 flex items-center gap-3 shrink-0"
        style={{ borderBottom: "1px solid var(--portal-border)" }}
      >
        <button onClick={onBack} style={{ color: "var(--portal-text-muted)" }}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span
          className="font-mono text-xs uppercase tracking-widest font-bold"
          style={{ color: "var(--portal-text)" }}
        >
          {t("inbox.newMessage")}
        </span>
      </div>

      {/* Form */}
      <div className="flex-1 p-4 space-y-4">
        <Input
          placeholder={t("inbox.subject")}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="font-mono text-sm bg-transparent border-0 border-b px-0 rounded-none focus-visible:ring-0"
          style={{ borderColor: "var(--portal-border)", color: "var(--portal-text)" }}
        />
        <Textarea
          placeholder={t("inbox.writePlaceholder")}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          className="font-mono text-sm bg-transparent border-0 px-0 rounded-none focus-visible:ring-0 resize-none"
          style={{ color: "var(--portal-text)" }}
        />
      </div>

      {/* Send */}
      <div className="p-4 shrink-0" style={{ borderTop: "1px solid var(--portal-border)" }}>
        <Button
          onClick={() => createMutation.mutate({ subject, body })}
          disabled={!subject.trim() || !body.trim() || createMutation.isPending}
          className="w-full font-mono text-xs uppercase tracking-widest"
          style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}
        >
          {createMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Send className="h-4 w-4 mr-2" />
          )}
          {t("inbox.send")}
        </Button>
      </div>
    </div>
  );
}

/* ─── Conversation View ─── */
function ConversationView({
  threadId,
  userId,
  onBack,
}: {
  threadId: string;
  userId: string;
  onBack?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [reply, setReply] = useState("");
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);

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
    onError: () => toast.error(t("inbox.replyError")),
  });

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (reply.trim()) replyMutation.mutate(reply.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="p-3 flex items-center gap-3 shrink-0"
        style={{ borderBottom: "1px solid var(--portal-border)" }}
      >
        {onBack && (
          <button onClick={onBack} style={{ color: "var(--portal-text-muted)" }}>
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-mono text-sm font-bold truncate" style={{ color: "var(--portal-text)" }}>
            {thread ? (thread as any).subject : "…"}
          </p>
          {thread && (
            <p className="font-mono text-[10px]" style={{ color: "var(--portal-text-muted)" }}>
              {(thread as any).status === "open" ? t("inbox.open") : t("inbox.closed")}
            </p>
          )}
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4 py-3">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--portal-text-muted)" }} />
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => {
              const isMe = msg.sender_id === userId;
              return (
                <div
                  key={msg.id}
                  className={cn("flex", isMe ? "justify-end" : "justify-start")}
                >
                  <div className="max-w-[80%] space-y-1">
                    {/* Sender label */}
                    <p
                      className={cn(
                        "font-mono text-xs font-bold px-1",
                        isMe ? "text-right" : "text-left"
                      )}
                      style={{ color: isMe ? "var(--portal-text-muted)" : "rgba(140, 255, 5, 0.8)" }}
                    >
                      {isMe ? t("inbox.you") : t("inbox.team")}
                    </p>

                    {/* Bubble */}
                    <div
                      className="px-3 py-2.5 text-sm whitespace-pre-wrap"
                      style={{
                        borderRadius: isMe ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                        background: isMe
                          ? "rgba(140, 255, 5, 0.18)"
                          : "rgba(255, 255, 255, 0.10)",
                        color: "var(--portal-text)",
                        border: isMe
                          ? "1px solid rgba(140, 255, 5, 0.3)"
                          : "1px solid rgba(255, 255, 255, 0.15)",
                      }}
                    >
                      {renderFormattedText(msg.body, { color: "rgba(140, 255, 5, 0.9)" })}
                    </div>

                    {/* Timestamp + read receipt */}
                    <div
                      className={cn(
                        "flex items-center gap-1 px-1",
                        isMe ? "justify-end" : "justify-start"
                      )}
                    >
                      <span className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
                        {new Date(msg.created_at).toLocaleString(i18n.language === "en" ? "en-US" : i18n.language === "es" ? "es-ES" : "pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {isMe && msg.is_read && (
                        <CheckCheck className="h-3 w-3" style={{ color: "rgba(140, 255, 5, 0.8)" }} />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </ScrollArea>

      {/* Reply box */}
      {thread && (thread as any).status === "open" && (
        <div
          className="p-3 flex items-end gap-2 shrink-0"
          style={{ borderTop: "1px solid rgba(255, 255, 255, 0.02)", background: "rgba(255, 255, 255, 0.004)" }}
        >
          <Textarea
            placeholder={t("inbox.replyPlaceholder")}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            className="flex-1 font-mono text-sm resize-none min-h-[36px] max-h-[120px]"
            style={{
              border: "1px solid rgba(255, 255, 255, 0.03)",
              background: "rgba(255, 255, 255, 0.008)",
              color: "var(--portal-text)",
              borderRadius: "18px",
              paddingLeft: "14px",
              paddingRight: "14px",
            }}
          />
          <button
            onClick={handleSend}
            disabled={!reply.trim() || replyMutation.isPending}
            className="h-9 w-9 flex items-center justify-center shrink-0 transition-opacity disabled:opacity-30"
            style={{
              background: "var(--portal-accent)",
              color: "var(--portal-accent-text)",
              borderRadius: "50%",
            }}
          >
            {replyMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}
