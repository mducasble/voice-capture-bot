import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Film, FileText, ExternalLink, User } from "lucide-react";

const CAMPAIGN_ID = "53fe3867-60a3-43c8-8ac8-da2957ada46f";

interface VideoSub {
  id: string;
  user_id: string;
  file_url: string | null;
  filename: string;
  metadata: Record<string, any> | null;
  created_at: string;
  quality_status: string | null;
}

interface TextSub {
  id: string;
  user_id: string;
  content: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

interface GroupedEntry {
  groupId: string;
  userId: string;
  originalUrl: string | null;
  modifiedUrl: string | null;
  text: string | null;
  createdAt: string;
}

export default function VideoSubmissionsReport() {
  const { data: videos, isLoading: loadingVids } = useQuery({
    queryKey: ["report-videos", CAMPAIGN_ID],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("video_submissions")
        .select("id, user_id, file_url, filename, metadata, created_at, quality_status")
        .eq("campaign_id", CAMPAIGN_ID)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as VideoSub[];
    },
  });

  const { data: texts, isLoading: loadingTexts } = useQuery({
    queryKey: ["report-texts", CAMPAIGN_ID],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("text_submissions")
        .select("id, user_id, content, metadata, created_at")
        .eq("campaign_id", CAMPAIGN_ID);
      if (error) throw error;
      return (data || []) as unknown as TextSub[];
    },
  });

  const userIds = useMemo(
    () => [...new Set((videos || []).map(v => v.user_id))],
    [videos]
  );

  const { data: profiles } = useQuery({
    queryKey: ["report-profiles", userIds],
    queryFn: async () => {
      if (!userIds.length) return [];
      const { data } = await supabase.from("profiles").select("id, full_name, email_contact").in("id", userIds);
      return data || [];
    },
    enabled: userIds.length > 0,
  });

  const profileMap = useMemo(() => {
    const m = new Map<string, string>();
    profiles?.forEach((p: any) => m.set(p.id, p.full_name || p.email_contact || p.id.slice(0, 8)));
    return m;
  }, [profiles]);

  const entries: GroupedEntry[] = useMemo(() => {
    if (!videos) return [];
    const groups = new Map<string, { original: string | null; modified: string | null; userId: string; createdAt: string }>();

    for (const v of videos) {
      const gid = (v.metadata as any)?.group_id;
      if (!gid) continue;
      if (!groups.has(gid)) groups.set(gid, { original: null, modified: null, userId: v.user_id, createdAt: v.created_at });
      const g = groups.get(gid)!;
      if ((v.metadata as any)?.video_role === "original") g.original = v.file_url;
      else if ((v.metadata as any)?.video_role === "modified") g.modified = v.file_url;
    }

    const textMap = new Map<string, string>();
    texts?.forEach(t => {
      const gid = (t.metadata as any)?.group_id;
      if (gid) textMap.set(gid, t.content || "");
    });

    return Array.from(groups.entries()).map(([gid, g]) => ({
      groupId: gid,
      userId: g.userId,
      originalUrl: g.original,
      modifiedUrl: g.modified,
      text: textMap.get(gid) ?? null,
      createdAt: g.createdAt,
    }));
  }, [videos, texts]);

  const isLoading = loadingVids || loadingTexts;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-1">Relatório — Vídeos Editados</h1>
        <p className="text-sm text-white/40 mb-8">{entries.length} participações agrupadas</p>

        {isLoading && (
          <div className="space-y-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 bg-white/[0.05]" />)}
          </div>
        )}

        {!isLoading && entries.length === 0 && (
          <p className="text-white/40 text-center py-16">Nenhuma submissão encontrada.</p>
        )}

        <div className="space-y-6">
          {entries.map((entry, idx) => (
            <div key={entry.groupId} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="font-mono text-xs text-white/20">#{idx + 1}</span>
                <span className="flex items-center gap-1 text-sm text-white/60">
                  <User className="h-3.5 w-3.5" /> {profileMap.get(entry.userId) || entry.userId.slice(0, 8)}
                </span>
                <span className="text-xs text-white/30 ml-auto">
                  {new Date(entry.createdAt).toLocaleDateString("pt-BR")}{" "}
                  {new Date(entry.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                {/* Original */}
                <div>
                  <p className="text-[11px] font-bold text-white/30 uppercase tracking-wider mb-2">
                    <Film className="h-3 w-3 inline mr-1" /> Vídeo Original
                  </p>
                  {entry.originalUrl ? (
                    <>
                      <video src={entry.originalUrl} controls className="w-full rounded-xl bg-black/40 max-h-56 object-contain" />
                      <a href={entry.originalUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-white/30 hover:text-white/60 mt-1 font-mono">
                        <ExternalLink className="h-3 w-3" /> Abrir link
                      </a>
                    </>
                  ) : (
                    <div className="h-32 rounded-xl bg-white/[0.04] flex items-center justify-center text-white/20 text-xs">Sem vídeo</div>
                  )}
                </div>

                {/* Modified */}
                <div>
                  <p className="text-[11px] font-bold text-white/30 uppercase tracking-wider mb-2">
                    <Film className="h-3 w-3 inline mr-1" /> Vídeo Editado
                  </p>
                  {entry.modifiedUrl ? (
                    <>
                      <video src={entry.modifiedUrl} controls className="w-full rounded-xl bg-black/40 max-h-56 object-contain" />
                      <a href={entry.modifiedUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-white/30 hover:text-white/60 mt-1 font-mono">
                        <ExternalLink className="h-3 w-3" /> Abrir link
                      </a>
                    </>
                  ) : (
                    <div className="h-32 rounded-xl bg-white/[0.04] flex items-center justify-center text-white/20 text-xs">Sem vídeo</div>
                  )}
                </div>
              </div>

              {/* Text */}
              <div>
                <p className="text-[11px] font-bold text-white/30 uppercase tracking-wider mb-2">
                  <FileText className="h-3 w-3 inline mr-1" /> Texto Enviado
                </p>
                <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-4 text-sm text-white/70 leading-relaxed whitespace-pre-wrap">
                  {entry.text || <span className="text-white/20 italic">Sem texto</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
