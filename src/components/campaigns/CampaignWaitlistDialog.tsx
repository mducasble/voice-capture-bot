import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Download, Mail, MessageCircle, Send, Users, Copy, Check } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface CampaignWaitlistDialogProps {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  campaignName: string;
}

interface WaitlistEntry {
  id: string;
  user_id: string;
  created_at: string;
  profile: {
    full_name: string | null;
    email_contact: string | null;
    whatsapp: string | null;
    telegram: string | null;
  } | null;
}

export function CampaignWaitlistDialog({ open, onClose, campaignId, campaignName }: CampaignWaitlistDialogProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const { data: entries, isLoading } = useQuery({
    queryKey: ["campaign-waitlist-admin", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_waitlist")
        .select("id, user_id, created_at")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: true });

      if (error) throw error;

      // Fetch profiles for all user_ids
      const userIds = (data || []).map(d => d.user_id);
      if (userIds.length === 0) return [];

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, email_contact, whatsapp, telegram")
        .in("id", userIds);

      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      return (data || []).map(entry => ({
        ...entry,
        profile: profileMap.get(entry.user_id) || null,
      })) as WaitlistEntry[];
    },
    enabled: open && !!campaignId,
  });

  const exportField = (field: "email_contact" | "whatsapp" | "telegram", label: string) => {
    if (!entries) return;
    const values = entries
      .map(e => e.profile?.[field])
      .filter(Boolean) as string[];

    if (values.length === 0) {
      toast({ title: `Nenhum ${label} encontrado`, variant: "destructive" });
      return;
    }

    const text = values.join("\n");
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast({ title: `${values.length} ${label}(s) copiados!` });
    setTimeout(() => setCopiedField(null), 2000);
  };

  const downloadCsv = () => {
    if (!entries || entries.length === 0) return;

    const header = "Nome,E-mail,WhatsApp,Telegram,Data Inscrição";
    const rows = entries.map(e => {
      const p = e.profile;
      return [
        p?.full_name || "",
        p?.email_contact || "",
        p?.whatsapp || "",
        p?.telegram || "",
        new Date(e.created_at).toLocaleDateString("pt-BR"),
      ].map(v => `"${v}"`).join(",");
    });

    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `waitlist-${campaignName.replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "CSV exportado!" });
  };

  const counts = {
    total: entries?.length || 0,
    email: entries?.filter(e => e.profile?.email_contact).length || 0,
    whatsapp: entries?.filter(e => e.profile?.whatsapp).length || 0,
    telegram: entries?.filter(e => e.profile?.telegram).length || 0,
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Waiting List — {campaignName}
          </DialogTitle>
          <DialogDescription>
            {isLoading ? "Carregando..." : `${counts.total} pessoa(s) na lista de espera`}
          </DialogDescription>
        </DialogHeader>

        {/* Export buttons */}
        <div className="flex flex-wrap gap-2 border-b pb-4">
          <Button variant="outline" size="sm" onClick={() => exportField("email_contact", "e-mail")} disabled={counts.email === 0}>
            {copiedField === "email_contact" ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Mail className="h-3.5 w-3.5 mr-1.5" />}
            E-mails ({counts.email})
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportField("whatsapp", "WhatsApp")} disabled={counts.whatsapp === 0}>
            {copiedField === "whatsapp" ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <MessageCircle className="h-3.5 w-3.5 mr-1.5" />}
            WhatsApp ({counts.whatsapp})
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportField("telegram", "Telegram")} disabled={counts.telegram === 0}>
            {copiedField === "telegram" ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
            Telegram ({counts.telegram})
          </Button>
          <Button variant="outline" size="sm" onClick={downloadCsv} disabled={counts.total === 0}>
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Exportar CSV
          </Button>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : entries?.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>Nenhuma pessoa na waiting list</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-1">
              {entries?.map((entry, i) => (
                <div key={entry.id} className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-muted/50 text-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-muted-foreground text-xs w-6 text-right shrink-0">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{entry.profile?.full_name || "Sem nome"}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {new Date(entry.created_at).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {entry.profile?.email_contact && (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <Mail className="h-2.5 w-2.5" /> E-mail
                      </Badge>
                    )}
                    {entry.profile?.whatsapp && (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <MessageCircle className="h-2.5 w-2.5" /> WA
                      </Badge>
                    )}
                    {entry.profile?.telegram && (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <Send className="h-2.5 w-2.5" /> TG
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
