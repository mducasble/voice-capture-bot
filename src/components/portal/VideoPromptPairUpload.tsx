import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Film, FileText, Upload, X, Loader2, CheckCircle2,
} from "lucide-react";
import KGenButton from "@/components/portal/KGenButton";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "react-i18next";

interface VideoPromptPairUploadProps {
  campaignId: string;
  taskSetId?: string;
}

interface VideoMeta {
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  frame_rate: number | null;
}

function getVideoMetadata(file: File): Promise<VideoMeta> {
  return new Promise((resolve) => {
    try {
      const video = document.createElement("video");
      video.preload = "metadata";
      const url = URL.createObjectURL(file);
      video.onloadedmetadata = () => {
        const dur = video.duration;
        const meta: VideoMeta = {
          duration_seconds: dur && isFinite(dur) ? Math.round(dur * 100) / 100 : null,
          width: video.videoWidth || null,
          height: video.videoHeight || null,
          frame_rate: null,
        };
        if ("requestVideoFrameCallback" in video) {
          let firstTs: number | null = null;
          let firstFrame: number | null = null;
          const cb = (_now: number, md: any) => {
            if (firstTs === null) {
              firstTs = md.mediaTime;
              firstFrame = md.presentedFrames;
              (video as any).requestVideoFrameCallback(cb);
            } else {
              const elapsed = md.mediaTime - firstTs;
              const frames = md.presentedFrames - (firstFrame ?? 0);
              if (elapsed > 0 && frames > 0) meta.frame_rate = Math.round(frames / elapsed);
              URL.revokeObjectURL(url);
              video.pause();
              video.src = "";
              resolve(meta);
            }
          };
          video.muted = true;
          video.playsInline = true;
          (video as any).requestVideoFrameCallback(cb);
          video.play().catch(() => { URL.revokeObjectURL(url); resolve(meta); });
        } else {
          URL.revokeObjectURL(url);
          resolve(meta);
        }
      };
      video.onerror = () => { URL.revokeObjectURL(url); resolve({ duration_seconds: null, width: null, height: null, frame_rate: null }); };
      video.src = url;
    } catch {
      resolve({ duration_seconds: null, width: null, height: null, frame_rate: null });
    }
  });
}

const VIDEO_ACCEPTS = ".mp4,.mov,.avi,.mkv,.webm,video/mp4,video/quicktime,video/x-msvideo,video/webm";

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function VideoPromptPairUpload({ campaignId, taskSetId }: VideoPromptPairUploadProps) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [originalVideo, setOriginalVideo] = useState<File | null>(null);
  const [modifiedVideo, setModifiedVideo] = useState<File | null>(null);
  const [promptText, setPromptText] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const [uploadDone, setUploadDone] = useState(false);

  const originalRef = useRef<HTMLInputElement>(null);
  const modifiedRef = useRef<HTMLInputElement>(null);

  const canSubmit = originalVideo && modifiedVideo && promptText.trim().length > 0;

  const uploadVideoToS3 = async (
    file: File,
    label: string,
    progressBase: number,
    progressSlice: number,
  ) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error(t("videoUpload.sessionExpired"));

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const ext = file.name.split(".").pop() || "mp4";
    const fn = `video_${label}_${ts}.${ext}`;
    const s3Folder = `campaigns/${campaignId}/videos/${user!.id}`;
    const mimeType = file.type || "application/octet-stream";

    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const uploadUrl = `https://${projectId}.supabase.co/functions/v1/stream-upload-to-s3?filename=${encodeURIComponent(fn)}&folder=${encodeURIComponent(s3Folder)}&content_type=${encodeURIComponent(mimeType)}`;

    const s3Result = await new Promise<any>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", uploadUrl);
      xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
      xhr.setRequestHeader("apikey", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
      xhr.setRequestHeader("Content-Type", mimeType);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round(progressBase + (e.loaded / e.total) * progressSlice));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error(t("videoUpload.invalidResponse"))); }
        } else {
          reject(new Error(`${t("videoUpload.uploadFailed")}: ${xhr.statusText}`));
        }
      };
      xhr.onerror = () => reject(new Error(t("videoUpload.networkError")));
      xhr.timeout = 10 * 60 * 1000;
      xhr.send(file);
    });

    return { fn, ext, s3Result };
  };

  const handleUpload = async () => {
    if (!canSubmit || !user) return;
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const groupId = crypto.randomUUID();

      // 1. Upload original video (0-40%)
      setCurrentStep(t("videoUpload.uploadingOriginal"));
      const orig = await uploadVideoToS3(originalVideo!, "original", 0, 40);
      const origMeta = await getVideoMetadata(originalVideo!);

      // 2. Upload modified video (40-80%)
      setCurrentStep(t("videoUpload.uploadingModified"));
      const mod = await uploadVideoToS3(modifiedVideo!, "modified", 40, 40);
      const modMeta = await getVideoMetadata(modifiedVideo!);

      // 3. Insert records (80-100%)
      setCurrentStep(t("videoUpload.registering"));
      setUploadProgress(85);

      const baseVideoPayload = (
        file: File, fn: string, ext: string, s3Result: any, meta: VideoMeta, role: string,
      ) => ({
        campaign_id: campaignId,
        user_id: user.id,
        task_set_id: taskSetId || null,
        filename: fn,
        file_url: s3Result.public_url,
        file_size_bytes: file.size,
        format: ext,
        duration_seconds: meta.duration_seconds,
        width: meta.width,
        height: meta.height,
        frame_rate: meta.frame_rate,
        metadata: {
          source: "video_prompt_pair",
          group_id: groupId,
          video_role: role,
          original_filename: file.name,
          s3_key: s3Result.s3_key,
        },
      });

      const { error: e1 } = await (supabase as any)
        .from("video_submissions")
        .insert(baseVideoPayload(originalVideo!, orig.fn, orig.ext, orig.s3Result, origMeta, "original"));
      if (e1) throw new Error(`${t("videoUpload.origRegFailed")}: ${e1.message}`);

      const { error: e2 } = await (supabase as any)
        .from("video_submissions")
        .insert(baseVideoPayload(modifiedVideo!, mod.fn, mod.ext, mod.s3Result, modMeta, "modified"));
      if (e2) throw new Error(`${t("videoUpload.modRegFailed")}: ${e2.message}`);

      setUploadProgress(92);

      const wordCount = promptText.trim().split(/\s+/).filter(Boolean).length;
      const { error: e3 } = await (supabase as any)
        .from("text_submissions")
        .insert({
          campaign_id: campaignId,
          user_id: user.id,
          task_set_id: taskSetId || null,
          content: promptText.trim(),
          word_count: wordCount,
          metadata: {
            source: "video_prompt_pair",
            group_id: groupId,
          },
        });
      if (e3) throw new Error(`${t("videoUpload.textRegFailed")}: ${e3.message}`);

      setUploadProgress(100);
      setUploadDone(true);
      toast.success(t("videoUpload.successToast"));
    } catch (err: any) {
      toast.error(t("videoUpload.errorPrefix") + (err.message || ""));
    } finally {
      setIsUploading(false);
      setCurrentStep("");
    }
  };

  const resetForm = () => {
    setOriginalVideo(null);
    setModifiedVideo(null);
    setPromptText("");
    setUploadDone(false);
    setUploadProgress(0);
  };

  if (uploadDone) {
    return (
      <div className="p-8 text-center space-y-4">
        <CheckCircle2 className="h-12 w-12 mx-auto" style={{ color: "var(--portal-accent)" }} />
        <h2 className="font-mono text-lg font-black uppercase" style={{ color: "var(--portal-text)" }}>
          {t("videoUpload.uploadDoneTitle")}
        </h2>
        <p className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
          {t("videoUpload.uploadDoneDesc")}
        </p>
        <KGenButton
          onClick={resetForm}
          className="mx-auto"
          size="default"
          scrambleText={t("videoUpload.sendMore")}
          icon={<Upload className="h-4 w-4" />}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Video Original */}
      <VideoSlot
        label={t("videoUpload.originalVideo")}
        hint={t("videoUpload.originalHint")}
        file={originalVideo}
        onSelect={(f) => setOriginalVideo(f)}
        onClear={() => setOriginalVideo(null)}
        inputRef={originalRef}
        disabled={isUploading}
        dropOrClick={t("videoUpload.dropOrClick")}
        acceptedFormats={t("videoUpload.acceptedFormats")}
      />

      {/* Video Modified */}
      <VideoSlot
        label={t("videoUpload.modifiedVideo")}
        hint={t("videoUpload.modifiedHint")}
        file={modifiedVideo}
        onSelect={(f) => setModifiedVideo(f)}
        onClear={() => setModifiedVideo(null)}
        inputRef={modifiedRef}
        disabled={isUploading}
        dropOrClick={t("videoUpload.dropOrClick")}
        acceptedFormats={t("videoUpload.acceptedFormats")}
      />

      {/* Prompt Text */}
      <div className="space-y-2">
        <label className="font-mono text-xs uppercase tracking-widest flex items-center gap-2" style={{ color: "var(--portal-text-muted)" }}>
          <FileText className="h-3.5 w-3.5" /> {t("videoUpload.promptLabel")}
        </label>
        <Textarea
          className="font-mono text-sm min-h-[120px]"
          style={{
            background: "var(--portal-card-bg)",
            border: "1px solid var(--portal-border)",
            color: "var(--portal-text)",
          }}
          placeholder={t("videoUpload.promptPlaceholder")}
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          disabled={isUploading}
        />
        <p className="font-mono text-[10px]" style={{ color: "var(--portal-text-muted)" }}>
          {promptText.trim().split(/\s+/).filter(Boolean).length} {t("videoUpload.words")}
        </p>
      </div>

      {/* Progress */}
      {isUploading && (
        <div className="space-y-2">
          <div className="h-1 w-full" style={{ background: "var(--portal-border)" }}>
            <div
              className="h-full transition-all duration-300"
              style={{ width: `${uploadProgress}%`, background: "var(--portal-accent)" }}
            />
          </div>
          <p className="font-mono text-[10px] text-center" style={{ color: "var(--portal-text-muted)" }}>
            {currentStep} ({uploadProgress}%)
          </p>
        </div>
      )}

      {/* Submit */}
      <KGenButton
        onClick={handleUpload}
        disabled={!canSubmit || isUploading}
        className="w-full"
        size="default"
        scrambleText={isUploading ? t("videoUpload.submitting") : t("videoUpload.submitButton")}
        icon={isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
      />
    </div>
  );
}

/* ---- Video Slot sub-component ---- */
function VideoSlot({
  label,
  hint,
  file,
  onSelect,
  onClear,
  inputRef,
  disabled,
  dropOrClick,
  acceptedFormats,
}: {
  label: string;
  hint: string;
  file: File | null;
  onSelect: (f: File) => void;
  onClear: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
  disabled: boolean;
  dropOrClick: string;
  acceptedFormats: string;
}) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onSelect(f);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-2">
      <label className="font-mono text-xs uppercase tracking-widest flex items-center gap-2" style={{ color: "var(--portal-text-muted)" }}>
        <Film className="h-3.5 w-3.5" /> {label}
      </label>
      <p className="font-mono text-[10px]" style={{ color: "var(--portal-text-muted)" }}>{hint}</p>

      <input
        ref={inputRef}
        type="file"
        accept={VIDEO_ACCEPTS}
        className="hidden"
        onChange={handleChange}
        disabled={disabled}
      />

      {file ? (
        <div
          className="flex items-center justify-between gap-3 p-3"
          style={{ border: "1px solid var(--portal-accent)", background: "var(--portal-card-bg)" }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Film className="h-4 w-4 shrink-0" style={{ color: "var(--portal-accent)" }} />
            <span className="font-mono text-xs truncate" style={{ color: "var(--portal-text)" }}>
              {file.name}
            </span>
            <span className="font-mono text-[10px] shrink-0" style={{ color: "var(--portal-text-muted)" }}>
              ({formatSize(file.size)})
            </span>
          </div>
          <button onClick={onClear} disabled={disabled}>
            <X className="h-4 w-4" style={{ color: "var(--portal-text-muted)" }} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="w-full p-6 text-center transition-colors"
          style={{ border: "1px dashed var(--portal-border)", background: "var(--portal-card-bg)" }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) onSelect(f);
          }}
        >
          <Upload className="h-6 w-6 mx-auto mb-2" style={{ color: "var(--portal-text-muted)" }} />
          <p className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
            {dropOrClick}
          </p>
          <p className="font-mono text-[10px] mt-1" style={{ color: "var(--portal-text-muted)" }}>
            {acceptedFormats}
          </p>
        </button>
      )}
    </div>
  );
}
