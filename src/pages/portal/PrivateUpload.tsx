import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Upload, Loader2, Film, X, Plus, CheckCircle2, AlertCircle,
  Mic, Image as ImageIcon, FileText,
} from "lucide-react";
import { useState, useRef } from "react";
import KGenButton from "@/components/portal/KGenButton";

interface UploadFile {
  id: string;
  file: File;
  label: string;
}

function getVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const video = document.createElement("video");
      video.preload = "metadata";
      const url = URL.createObjectURL(file);
      video.onloadedmetadata = () => {
        const dur = video.duration;
        URL.revokeObjectURL(url);
        resolve(dur && isFinite(dur) ? Math.round(dur * 100) / 100 : null);
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      video.src = url;
    } catch {
      resolve(null);
    }
  });
}

function getImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    } catch {
      resolve(null);
    }
  });
}

// --- Type config map ---
interface TypeConfig {
  icon: React.ReactNode;
  label: string;
  accepts: string;
  hint: string;
  table: "video_submissions" | "image_submissions" | "voice_recordings";
  storagePath: string;
  filenamePrefix: string;
  formatFromExt: boolean;
  extraInsertFields?: (file: File) => Record<string, any>;
}

function getTypeConfig(campaignType: string | null): TypeConfig {
  switch (campaignType) {
    case "image_submission":
      return {
        icon: <ImageIcon className="h-8 w-8" style={{ color: "var(--portal-accent)" }} />,
        label: "Upload de Imagem",
        accepts: ".jpg,.jpeg,.png,.webp,.heic,.heif,.bmp,.tiff,image/jpeg,image/png,image/webp",
        hint: "JPG, PNG, WebP, HEIC",
        table: "image_submissions",
        storagePath: "images",
        filenamePrefix: "img",
        formatFromExt: true,
      };
    case "audio_capture_solo":
    case "audio_capture_group":
      return {
        icon: <Mic className="h-8 w-8" style={{ color: "var(--portal-accent)" }} />,
        label: "Upload de Áudio",
        accepts: ".wav,.mp3,.flac,.ogg,.m4a,.aac,audio/wav,audio/mpeg,audio/flac,audio/ogg",
        hint: "WAV, MP3, FLAC, OGG, M4A",
        table: "voice_recordings",
        storagePath: "audio",
        filenamePrefix: "audio",
        formatFromExt: true,
        extraInsertFields: () => ({
          recording_type: "individual",
          status: "uploaded",
        }),
      };
    case "video_submission":
    default:
      return {
        icon: <Film className="h-8 w-8" style={{ color: "var(--portal-accent)" }} />,
        label: "Upload de Vídeo",
        accepts: ".mp4,.mov,.avi,.mkv,.webm,video/mp4,video/quicktime,video/x-msvideo,video/webm",
        hint: "MP4, MOV, AVI, MKV, WebM",
        table: "video_submissions",
        storagePath: "videos",
        filenamePrefix: "video",
        formatFromExt: true,
      };
  }
}

// --- Small icon for file list ---
function FileListIcon({ campaignType }: { campaignType: string | null }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  const style = { color: "var(--portal-text-muted)" };
  switch (campaignType) {
    case "image_submission":
      return <ImageIcon className={cls} style={style} />;
    case "audio_capture_solo":
    case "audio_capture_group":
      return <Mic className={cls} style={style} />;
    default:
      return <Film className={cls} style={style} />;
  }
}

// --- Hook: resolve slug → campaign ---
function useSlugCampaign(slug: string | undefined) {
  return useQuery({
    queryKey: ["private-upload", slug],
    queryFn: async () => {
      if (!slug) throw new Error("No slug");
      const { data: link, error: le } = await supabase
        .from("short_links")
        .select("target_path")
        .eq("slug", slug)
        .single();
      if (le || !link) throw new Error("Link não encontrado");

      const match = link.target_path.match(
        /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
      );
      if (!match) throw new Error("Campanha inválida");
      const campaignId = match[1];

      const { data: campaign, error: ce } = await supabase
        .from("campaigns")
        .select("id, name, description, campaign_type")
        .eq("id", campaignId)
        .single();
      if (ce || !campaign) throw new Error("Campanha não encontrada");
      return campaign;
    },
    enabled: !!slug,
    retry: false,
  });
}

// --- Main component ---
export default function PrivateUpload() {
  const { slug } = useParams<{ slug: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { data: campaign, isLoading, error } = useSlugCampaign(slug);

  const [files, setFiles] = useState<UploadFile[]>([]);
  const [senderName, setSenderName] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const [uploadDone, setUploadDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const typeConfig = getTypeConfig(campaign?.campaign_type ?? null);

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
    const newFiles: UploadFile[] = Array.from(selected).map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      label: f.name,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length === 0) {
      toast.error("Nenhum arquivo válido detectado.");
      return;
    }
    const newFiles: UploadFile[] = dropped.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      label: f.name,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
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
      const safeName = senderName
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_\-]/g, "_");

      for (let i = 0; i < files.length; i++) {
        const uf = files[i];
        const fileBase = (i / files.length) * 90;
        const fileSlice = 90 / files.length;
        setUploadProgress(Math.round(fileBase));
        setCurrentStep(`Enviando ${uf.file.name} (${i + 1}/${files.length})...`);

        const ext = uf.file.name.split(".").pop() || "bin";
        const fn = `${typeConfig.filenamePrefix}_${ts}_${safeName}_${i + 1}.${ext}`;
        const s3Folder = `campaigns/${campaign.id}/${typeConfig.storagePath}/${user.id}`;

        // Determine content type
        const mimeType = uf.file.type || "application/octet-stream";

        // Get auth token
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (!currentSession?.access_token) throw new Error("Sessão expirada. Faça login novamente.");

        // Stream upload to S3 via edge function with XHR for progress
        const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
        const uploadUrl = `https://${projectId}.supabase.co/functions/v1/stream-upload-to-s3?filename=${encodeURIComponent(fn)}&folder=${encodeURIComponent(s3Folder)}&content_type=${encodeURIComponent(mimeType)}`;

        const s3Result = await new Promise<any>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", uploadUrl);
          xhr.setRequestHeader("Authorization", `Bearer ${currentSession.access_token}`);
          xhr.setRequestHeader("apikey", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
          xhr.setRequestHeader("Content-Type", mimeType);

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const filePct = (e.loaded / e.total) * fileSlice;
              setUploadProgress(Math.round(fileBase + filePct));
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch {
                reject(new Error("Resposta inválida do servidor"));
              }
            } else {
              try {
                const errData = JSON.parse(xhr.responseText);
                reject(new Error(`Upload S3 falhou: ${errData.error || xhr.statusText}`));
              } catch {
                reject(new Error(`Upload S3 falhou: ${xhr.statusText}`));
              }
            }
          };

          xhr.onerror = () => reject(new Error("Erro de rede no upload"));
          xhr.ontimeout = () => reject(new Error("Upload expirou (timeout)"));
          xhr.timeout = 10 * 60 * 1000; // 10 min timeout

          xhr.send(uf.file);
        });

        // Build insert payload based on type
        const basePayload: Record<string, any> = {
          campaign_id: campaign.id,
          user_id: user.id,
          filename: fn,
          file_url: s3Result.public_url,
          metadata: {
            source: "private_upload",
            original_filename: uf.file.name,
            sender_name: senderName.trim(),
            slug,
            s3_key: s3Result.s3_key,
          },
        };

        // Type-specific fields
        if (typeConfig.table === "video_submissions") {
          basePayload.file_size_bytes = uf.file.size;
          basePayload.format = ext;
          const duration = await getVideoDuration(uf.file);
          if (duration != null) basePayload.duration_seconds = duration;
        } else if (typeConfig.table === "image_submissions") {
          basePayload.file_size_bytes = uf.file.size;
          basePayload.format = ext;
          const dims = await getImageDimensions(uf.file);
          if (dims) {
            basePayload.width = dims.width;
            basePayload.height = dims.height;
          }
        }

        if (typeConfig.table === "voice_recordings") {
          basePayload.file_size_bytes = uf.file.size;
          basePayload.discord_username = senderName.trim();
          if (typeConfig.extraInsertFields) {
            Object.assign(basePayload, typeConfig.extraInsertFields(uf.file));
          }
        }

        const { error: ie } = await (supabase as any)
          .from(typeConfig.table)
          .insert(basePayload);
        if (ie) throw new Error(`Registro falhou: ${ie.message}`);
      }

      setUploadProgress(100);
      setUploadDone(true);
      toast.success("Arquivos enviados com sucesso!");
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
              Seus arquivos foram recebidos com sucesso. Obrigado!
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
              {typeConfig.label}
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
              onChange={(e) => setSenderName(e.target.value)}
              disabled={isUploading}
            />
          </div>

          {/* Drop zone / file list */}
          <input
            ref={fileInputRef}
            type="file"
            accept={typeConfig.accepts}
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />

          {files.length === 0 ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className="w-full p-10 flex flex-col items-center gap-3 transition-colors cursor-pointer"
              style={{ border: "2px dashed var(--portal-border)", background: "var(--portal-card-bg)" }}
            >
              {typeConfig.icon}
              <span className="font-mono text-xs text-center" style={{ color: "var(--portal-text-muted)" }}>
                Arraste arquivos aqui ou clique para selecionar
              </span>
              <span className="font-mono text-[10px]" style={{ color: "var(--portal-text-muted)" }}>
                {typeConfig.hint}
              </span>
            </button>
          ) : (
            <div className="space-y-2">
              {files.map((uf, idx) => (
                <div
                  key={uf.id}
                  className="flex items-center gap-3 p-3"
                  style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}
                >
                  <span className="font-mono text-xs font-bold w-6 text-center" style={{ color: "var(--portal-accent)" }}>
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <FileListIcon campaignType={campaign.campaign_type} />
                      <span className="font-mono text-xs truncate" style={{ color: "var(--portal-text)" }}>
                        {uf.file.name}
                      </span>
                      <span className="font-mono text-[10px] shrink-0" style={{ color: "var(--portal-text-muted)" }}>
                        {formatSize(uf.file.size)}
                      </span>
                    </div>
                  </div>
                  {!isUploading && (
                    <button
                      onClick={() => setFiles((prev) => prev.filter((f) => f.id !== uf.id))}
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
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className="w-full flex items-center justify-center gap-2 py-2 font-mono text-xs uppercase tracking-widest transition-colors"
              style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}
            >
              <Plus className="h-3.5 w-3.5" /> Adicionar Arquivo
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
            scrambleText={isUploading ? "ENVIANDO..." : "ENVIAR ARQUIVOS"}
            icon={isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          />
        </div>
      </div>
    </div>
  );
}
