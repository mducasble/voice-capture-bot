import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Upload, Loader2, Film, X, Plus, CheckCircle2, AlertCircle,
} from "lucide-react";
import { useState, useRef, useCallback } from "react";
import KGenButton from "@/components/portal/KGenButton";

interface VideoFile {
  id: string;
  file: File;
  label: string;
}

function useSlugCampaign(slug: string | undefined) {
  return useQuery({
    queryKey: ["private-upload", slug],
    queryFn: async () => {
      if (!slug) throw new Error("No slug");
      // Resolve slug → campaign id
      const { data: link, error: le } = await supabase
        .from("short_links")
        .select("target_path")
        .eq("slug", slug)
        .single();
      if (le || !link) throw new Error("Link não encontrado");

      // Extract campaign id from target_path (format: /campaign/:id or just the uuid)
      const match = link.target_path.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (!match) throw new Error("Campanha inválida");
      const campaignId = match[1];

      const { data: campaign, error: ce } = await supabase
        .from("campaigns")
        .select("id, name, description")
        .eq("id", campaignId)
        .single();
      if (ce || !campaign) throw new Error("Campanha não encontrada");
      return campaign;
    },
    enabled: !!slug,
    retry: false,
  });
}

export default function PrivateUpload() {
  const { slug } = useParams<{ slug: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { data: campaign, isLoading, error } = useSlugCampaign(slug);

  const [files, setFiles] = useState<VideoFile[]>([]);
  const [senderName, setSenderName] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const [uploadDone, setUploadDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ACCEPTED = ".mp4,.mov,.avi,.mkv,.webm,video/mp4,video/quicktime,video/x-msvideo,video/webm";

  // Redirect to auth if not logged in
  if (!authLoading && !user) {
    sessionStorage.setItem("redirect_after_login", `/c/${slug}`);
    navigate("/auth", { replace: true });
    return null;
  }

  if (authLoading || isLoading) {
    return (
      <div className="portal-auth-page min-h-screen flex items-center justify-center">
        <Skeleton className="h-64 w-full max-w-xl" style={{ background: "var(--portal-card-bg)" }} />
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="portal-auth-page min-h-screen flex items-center justify-center">
        <div className="p-8 text-center max-w-md" style={{ border: "1px solid var(--portal-border)" }}>
          <AlertCircle className="h-8 w-8 mx-auto mb-4" style={{ color: "var(--portal-text-muted)" }} />
          <p className="font-mono text-sm" style={{ color: "var(--portal-text-muted)" }}>
            Link inválido ou campanha não encontrada.
          </p>
        </div>
      </div>
    );
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected) return;
    const newFiles: VideoFile[] = Array.from(selected).map(f => ({
      id: crypto.randomUUID(),
      file: f,
      label: f.name,
    }));
    setFiles(prev => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("video/"));
    if (dropped.length === 0) {
      toast.error("Apenas arquivos de vídeo são aceitos.");
      return;
    }
    const newFiles: VideoFile[] = dropped.map(f => ({
      id: crypto.randomUUID(),
      file: f,
      label: f.name,
    }));
    setFiles(prev => [...prev, ...newFiles]);
  };

  const formatSize = (bytes: number) =>
    bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : bytes < 1024 * 1024 * 1024
        ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
        : `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;

  const canSubmit = files.length > 0 && senderName.trim().length > 0;

  const handleUpload = async () => {
    if (!canSubmit || !user || !campaign) return;
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");

      for (let i = 0; i < files.length; i++) {
        const vf = files[i];
        const pct = Math.round(((i) / files.length) * 90);
        setUploadProgress(pct);
        setCurrentStep(`Enviando ${vf.file.name}...`);

        const ext = vf.file.name.split(".").pop() || "mp4";
        const safeName = senderName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_\-]/g, "_");
        const fn = `video_${ts}_${safeName}_${i + 1}.${ext}`;
        const path = `videos/${campaign.id}/${user.id}/${fn}`;

        const { error: ue } = await supabase.storage
          .from("campaign-files")
          .upload(path, vf.file);
        if (ue) throw new Error(`Upload falhou: ${ue.message}`);

        const { data: urlData } = supabase.storage
          .from("campaign-files")
          .getPublicUrl(path);

        const { error: ie } = await supabase.from("video_submissions").insert({
          campaign_id: campaign.id,
          user_id: user.id,
          filename: fn,
          file_url: urlData.publicUrl,
          file_size_bytes: vf.file.size,
          format: ext,
          metadata: {
            source: "private_upload",
            original_filename: vf.file.name,
            sender_name: senderName.trim(),
            slug,
          },
        });
        if (ie) throw new Error(`Registro falhou: ${ie.message}`);
      }

      setUploadProgress(100);
      setUploadDone(true);
      toast.success("Vídeos enviados com sucesso!");
      setFiles([]);
    } catch (err: any) {
      toast.error("Erro: " + (err.message || "Tente novamente"));
    } finally {
      setIsUploading(false);
      setCurrentStep("");
    }
  };

  if (uploadDone) {
    return (
      <div className="portal-auth-page min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-xl" style={{ border: "1px solid var(--portal-border)" }}>
          <div className="p-8 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 mx-auto" style={{ color: "var(--portal-accent)" }} />
            <h2 className="font-mono text-lg font-black uppercase" style={{ color: "var(--portal-text)" }}>
              Envio Concluído
            </h2>
            <p className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
              Seus vídeos foram recebidos com sucesso. Obrigado!
            </p>
            <KGenButton
              onClick={() => { setUploadDone(false); setUploadProgress(0); }}
              className="mx-auto"
              size="default"
              scrambleText="ENVIAR MAIS"
              icon={<Upload className="h-4 w-4" />}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="portal-auth-page min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-xl" style={{ border: "1px solid var(--portal-border)" }}>
        {/* Header */}
        <div className="p-6" style={{ borderBottom: "1px solid var(--portal-border)" }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-3 h-3" style={{ background: "var(--portal-accent)" }} />
            <span className="font-mono text-xs tracking-[0.3em] uppercase" style={{ color: "var(--portal-accent)" }}>
              Upload de Vídeo
            </span>
          </div>
          <h1 className="font-mono text-xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
            {campaign.name}
          </h1>
          {campaign.description && (
            <p className="font-mono text-xs mt-2 leading-relaxed" style={{ color: "var(--portal-text-muted)" }}>
              {campaign.description}
            </p>
          )}
        </div>

        <div className="p-6 space-y-4">
          {/* Sender name */}
          <div className="space-y-2">
            <label className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
              Seu Nome / Identificação
            </label>
            <input
              className="portal-brutalist-input w-full"
              placeholder="Digite seu nome..."
              value={senderName}
              onChange={e => setSenderName(e.target.value)}
              disabled={isUploading}
            />
          </div>

          {/* Drop zone / file list */}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />

          {files.length === 0 ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              className="w-full p-10 flex flex-col items-center gap-3 transition-colors cursor-pointer"
              style={{ border: "2px dashed var(--portal-border)", background: "var(--portal-card-bg)" }}
            >
              <Film className="h-8 w-8" style={{ color: "var(--portal-accent)" }} />
              <span className="font-mono text-xs text-center" style={{ color: "var(--portal-text-muted)" }}>
                Arraste vídeos aqui ou clique para selecionar
              </span>
              <span className="font-mono text-[10px]" style={{ color: "var(--portal-text-muted)" }}>
                MP4, MOV, AVI, MKV, WebM
              </span>
            </button>
          ) : (
            <div className="space-y-2">
              {files.map((vf, idx) => (
                <div
                  key={vf.id}
                  className="flex items-center gap-3 p-3"
                  style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}
                >
                  <span className="font-mono text-xs font-bold w-6 text-center" style={{ color: "var(--portal-accent)" }}>
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Film className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--portal-text-muted)" }} />
                      <span className="font-mono text-xs truncate" style={{ color: "var(--portal-text)" }}>
                        {vf.file.name}
                      </span>
                      <span className="font-mono text-[10px] shrink-0" style={{ color: "var(--portal-text-muted)" }}>
                        {formatSize(vf.file.size)}
                      </span>
                    </div>
                  </div>
                  {!isUploading && (
                    <button
                      onClick={() => setFiles(prev => prev.filter(f => f.id !== vf.id))}
                      style={{ color: "var(--portal-text-muted)" }}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add more button */}
          {files.length > 0 && !isUploading && (
            <button
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              className="w-full flex items-center justify-center gap-2 py-2 font-mono text-xs uppercase tracking-widest transition-colors"
              style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}
            >
              <Plus className="h-3.5 w-3.5" /> Adicionar Vídeo
            </button>
          )}

          {/* Progress */}
          {isUploading && (
            <div className="space-y-2 p-4" style={{ border: "1px solid var(--portal-border)" }}>
              <div className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "var(--portal-accent)" }} />
                <span className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
                  {currentStep}
                </span>
              </div>
              <div className="w-full h-1" style={{ background: "var(--portal-border)" }}>
                <div
                  className="h-full transition-all"
                  style={{ width: `${uploadProgress}%`, background: "var(--portal-accent)" }}
                />
              </div>
            </div>
          )}

          {/* Submit */}
          <KGenButton
            onClick={handleUpload}
            disabled={!canSubmit || isUploading}
            className="w-full"
            size="default"
            scrambleText={isUploading ? "ENVIANDO..." : "ENVIAR VÍDEOS"}
            icon={isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          />
        </div>
      </div>
    </div>
  );
}
