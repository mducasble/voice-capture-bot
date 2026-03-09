import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, GripVertical } from "lucide-react";

interface FaqItem {
  id: string;
  category: string;
  sort_order: number;
  is_active: boolean;
  question_pt: string;
  question_en: string | null;
  question_es: string | null;
  answer_pt: string;
  answer_en: string | null;
  answer_es: string | null;
}

const EMPTY: Omit<FaqItem, "id"> = {
  category: "general",
  sort_order: 0,
  is_active: true,
  question_pt: "",
  question_en: "",
  question_es: "",
  answer_pt: "",
  answer_en: "",
  answer_es: "",
};

export default function AdminFaq() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FaqItem | null>(null);
  const [form, setForm] = useState<Omit<FaqItem, "id">>(EMPTY);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["admin-faq"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("faq_items")
        .select("*")
        .order("category")
        .order("sort_order");
      if (error) throw error;
      return data as FaqItem[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (item: Omit<FaqItem, "id"> & { id?: string }) => {
      if (item.id) {
        const { error } = await supabase.from("faq_items").update(item).eq("id", item.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("faq_items").insert(item);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-faq"] });
      toast.success("FAQ salvo!");
      closeDialog();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("faq_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-faq"] });
      toast.success("FAQ removido!");
    },
  });

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY, sort_order: items.length });
    setDialogOpen(true);
  };

  const openEdit = (item: FaqItem) => {
    setEditing(item);
    setForm({
      category: item.category,
      sort_order: item.sort_order,
      is_active: item.is_active,
      question_pt: item.question_pt,
      question_en: item.question_en || "",
      question_es: item.question_es || "",
      answer_pt: item.answer_pt,
      answer_en: item.answer_en || "",
      answer_es: item.answer_es || "",
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
    setForm(EMPTY);
  };

  const handleSave = () => {
    if (!form.question_pt.trim() || !form.answer_pt.trim()) {
      toast.error("Pergunta e resposta em PT são obrigatórios.");
      return;
    }
    saveMutation.mutate(editing ? { ...form, id: editing.id } : form);
  };

  // Group by category
  const grouped = items.reduce<Record<string, FaqItem[]>>((acc, item) => {
    (acc[item.category] = acc[item.category] || []).push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">FAQ / Dúvidas</h1>
          <p className="text-sm text-muted-foreground">Gerencie as perguntas frequentes do portal.</p>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" /> Nova Pergunta
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">Carregando...</p>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="border border-dashed rounded-lg p-12 text-center text-muted-foreground">
          Nenhuma pergunta cadastrada.
        </div>
      ) : (
        Object.entries(grouped).map(([cat, catItems]) => (
          <div key={cat} className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">{cat}</h2>
            <div className="space-y-1">
              {catItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors group"
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{item.question_pt}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.answer_pt.substring(0, 80)}...</p>
                  </div>
                  {!item.is_active && <Badge variant="outline" className="text-xs">Inativo</Badge>}
                  <Badge variant="secondary" className="text-xs shrink-0">#{item.sort_order}</Badge>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(item)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(item.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Edit / Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Pergunta" : "Nova Pergunta"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Categoria</label>
                <Input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="general" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Ordem</label>
                <Input type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))} />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
              <span className="text-sm text-foreground">Ativo</span>
            </div>

            {/* PT */}
            <div className="space-y-2 p-3 rounded-lg border">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">🇧🇷 Português</p>
              <Input value={form.question_pt} onChange={e => setForm(f => ({ ...f, question_pt: e.target.value }))} placeholder="Pergunta *" />
              <Textarea value={form.answer_pt} onChange={e => setForm(f => ({ ...f, answer_pt: e.target.value }))} placeholder="Resposta *" rows={3} />
            </div>

            {/* EN */}
            <div className="space-y-2 p-3 rounded-lg border">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">🇺🇸 English</p>
              <Input value={form.question_en || ""} onChange={e => setForm(f => ({ ...f, question_en: e.target.value }))} placeholder="Question" />
              <Textarea value={form.answer_en || ""} onChange={e => setForm(f => ({ ...f, answer_en: e.target.value }))} placeholder="Answer" rows={3} />
            </div>

            {/* ES */}
            <div className="space-y-2 p-3 rounded-lg border">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">🇪🇸 Español</p>
              <Input value={form.question_es || ""} onChange={e => setForm(f => ({ ...f, question_es: e.target.value }))} placeholder="Pregunta" />
              <Textarea value={form.answer_es || ""} onChange={e => setForm(f => ({ ...f, answer_es: e.target.value }))} placeholder="Respuesta" rows={3} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeDialog}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}