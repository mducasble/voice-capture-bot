import { useState, useEffect, useCallback } from "react";
import { RotateCw, Loader2, CheckCircle, Download } from "lucide-react";
import { listKeys, loadBlob, deleteByPrefix } from "@/lib/audioIndexedDB";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  sessionId: string;
  campaignId: string;
}

export function ResendAudioButton({ sessionId, campaignId }: Props) {
  const [blobKeys, setBlobKeys] = useState<string[]>([]);
  const [checking, setChecking] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listKeys()
      .then((keys) => {
        if (!cancelled) {
          const matching = keys.filter((k) => k.startsWith(`${sessionId}_`));
          setBlobKeys(matching);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [sessionId]);

  const handleResend = useCallback(async () => {
    if (uploading || blobKeys.length === 0) return;
    setUploading(true);
    setProgress(0);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      let completed = 0;

      for (const key of blobKeys) {
        const blob = await loadBlob(key);
        if (!blob || blob.size === 0) {
          completed++;
          setProgress(Math.round((completed / blobKeys.length) * 100));
          continue;
        }

        // Determine recording type from key pattern
        const suffix = key.replace(`${sessionId}_`, "");
        let recordingType = "individual";
        let participantName = "Unknown";

        if (suffix === "mixed") {
          recordingType = "mixed";
          participantName = "Mixed";
        } else if (suffix.startsWith("remote_")) {
          recordingType = "remote_backup";
          participantName = `Backup ${suffix.replace("remote_", "").slice(0, 8)}`;
        }

        const filename = `room_${sessionId}_${suffix}_resend_${Date.now()}.wav`;

        // Upload via streaming proxy
        const streamUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stream-upload-to-s3?filename=${encodeURIComponent(filename)}&session_id=${encodeURIComponent(sessionId)}&content_type=${encodeURIComponent("audio/wav")}`;
        const streamRes = await fetch(streamUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "audio/wav",
          },
          body: blob,
        });

        if (!streamRes.ok) {
          console.error("[Resend] Stream upload failed:", await streamRes.text());
          throw new Error(`Upload failed for ${suffix}`);
        }

        const { public_url: finalUrl } = await streamRes.json();

        // Register in DB
        const regRes = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/register-room-recording`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${authToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              filename,
              file_url: finalUrl,
              file_size_bytes: blob.size,
              session_id: sessionId,
              participant_id: "resend",
              participant_name: participantName,
              recording_type: recordingType,
              format: "wav",
              campaign_id: campaignId,
              sample_rate: 48000,
            }),
          }
        );

        if (!regRes.ok) {
          console.error("[Resend] Registration failed:", await regRes.text());
          throw new Error(`Registration failed for ${suffix}`);
        }

        completed++;
        setProgress(Math.round((completed / blobKeys.length) * 100));
      }

      // Clean up IndexedDB after successful resend
      await deleteByPrefix(`${sessionId}_`);
      setBlobKeys([]);
      setDone(true);
      toast.success(`${blobKeys.length} áudio(s) reenviado(s) com sucesso!`);
    } catch (err) {
      console.error("[Resend] Error:", err);
      toast.error("Erro ao reenviar: " + (err as Error).message);
    } finally {
      setUploading(false);
    }
  }, [uploading, blobKeys, sessionId, campaignId]);

  const handleDownloadAll = useCallback(async () => {
    for (const key of blobKeys) {
      const blob = await loadBlob(key);
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${key}.wav`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [blobKeys]);

  if (checking || blobKeys.length === 0) return null;

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-xs px-2 py-1" style={{ color: "#22c55e" }}>
        <CheckCircle className="h-3 w-3" /> Reenviado
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        onClick={(e) => { e.stopPropagation(); handleResend(); }}
        disabled={uploading}
        className="inline-flex items-center gap-1 font-mono text-xs uppercase tracking-widest px-2 py-1 transition-colors"
        style={{
          color: uploading ? "var(--portal-text-muted)" : "var(--portal-accent)",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid var(--portal-border)",
          cursor: uploading ? "wait" : "pointer",
        }}
      >
        {uploading ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" /> {progress}%
          </>
        ) : (
          <>
            <RotateCw className="h-3 w-3" /> Reenviar ({blobKeys.length})
          </>
        )}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); handleDownloadAll(); }}
        className="inline-flex items-center gap-1 font-mono text-xs px-1.5 py-1 transition-colors"
        style={{ color: "var(--portal-text-muted)", cursor: "pointer" }}
        title="Baixar áudios locais"
      >
        <Download className="h-3 w-3" />
      </button>
    </span>
  );
}
