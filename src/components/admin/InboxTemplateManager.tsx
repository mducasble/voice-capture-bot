import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  FileText, Pencil, Save, X, Loader2, ChevronDown, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import FormattingToolbar from "./FormattingToolbar";
import { renderFormattedText } from "@/lib/formatInboxMessage";

interface Template {
  id: string;
  template_key: string;
  subject: string;
  category: string;
  body: string;
}

const categoryLabels: Record<string, string> = {
  general: "Geral",
  payment: "Pagamento",
  support: "Suporte",
};

export default function InboxTemplateManager() {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Template>>({});

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["admin-inbox-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inbox_message_templates" as any)
        .select("id, template_key, subject, category, body")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as Template[];
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (tpl: Partial<Template> & { id: string }) => {
      const { error } = await supabase
        .from("inbox_message_templates" as any)
        .update({
          subject: tpl.subject,
          category: tpl.category,
          body: tpl.body,
        } as any)
        .eq("id", tpl.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Template atualizado!");
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["admin-inbox-templates"] });
    },
    onError: () => toast.error("Erro ao atualizar template"),
  });

  const startEdit = (tpl: Template) => {
    setEditingId(tpl.id);
    setEditForm({ subject: tpl.subject, category: tpl.category, body: tpl.body });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveEdit = () => {
    if (!editingId || !editForm.subject?.trim() || !editForm.body?.trim()) return;
    updateMutation.mutate({ id: editingId, ...editForm });
  };

  return (
    <div className="rounded-xl border bg-muted/5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-muted/10 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <FileText className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">Templates de Mensagem</span>
        <span className="text-xs text-muted-foreground ml-1">({templates.length})</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum template cadastrado</p>
          ) : (
            templates.map((tpl) => {
              const isEditing = editingId === tpl.id;
              return (
                <div key={tpl.id} className="rounded-lg border p-4 space-y-3">
                  {isEditing ? (
                    <>
                      <div className="flex gap-2">
                        <Input
                          value={editForm.subject || ""}
                          onChange={(e) => setEditForm((f) => ({ ...f, subject: e.target.value }))}
                          placeholder="Assunto"
                          className="flex-1 text-sm"
                        />
                        <div className="flex gap-1">
                          {["general", "payment", "support"].map((cat) => (
                            <button
                              key={cat}
                              onClick={() => setEditForm((f) => ({ ...f, category: cat }))}
                              className={cn(
                                "text-xs px-2.5 py-1 rounded-full border transition-colors",
                                editForm.category === cat
                                  ? "border-primary text-primary bg-primary/10"
                                  : "border-border text-muted-foreground"
                              )}
                            >
                              {categoryLabels[cat] || cat}
                            </button>
                          ))}
                        </div>
                      </div>
                      <Textarea
                        value={editForm.body || ""}
                        onChange={(e) => setEditForm((f) => ({ ...f, body: e.target.value }))}
                        rows={6}
                        className="text-sm resize-none"
                      />
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={cancelEdit}>
                          <X className="h-3.5 w-3.5 mr-1" /> Cancelar
                        </Button>
                        <Button
                          size="sm"
                          onClick={saveEdit}
                          disabled={updateMutation.isPending}
                        >
                          {updateMutation.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                          ) : (
                            <Save className="h-3.5 w-3.5 mr-1" />
                          )}
                          Salvar
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-semibold text-foreground truncate">
                            {tpl.subject}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-full border border-border text-muted-foreground shrink-0">
                            {categoryLabels[tpl.category] || tpl.category}
                          </span>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => startEdit(tpl)}>
                          <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                        </Button>
                      </div>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                        {tpl.body}
                      </p>
                      <span className="text-xs text-muted-foreground/60">
                        key: {tpl.template_key}
                      </span>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
