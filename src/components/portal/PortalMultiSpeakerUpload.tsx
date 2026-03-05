import { useState, useRef, useCallback } from "react";
import { Upload, Loader2, FileAudio, X, Plus, Mic, Music } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { getAudioMetadata } from "@/lib/audioMetadata";
import KGenButton from "@/components/portal/KGenButton";

interface SpeakerFile {
  id: string;
  file: File;
  speakerName: string;
}

interface PortalMultiSpeakerUploadProps {
  campaignId: string;
  onUploadComplete?: () => void;
}

export function PortalMultiSpeakerUpload({ campaignId, onUploadComplete }: PortalMultiSpeakerUploadProps) {
  const [speakerFiles, setSpeakerFiles] = useState<SpeakerFile[]>([]);
  const [mixedFile, setMixedFile] = useState<File | null>(null);
  const [autoMix, setAutoMix] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mixedFileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const isValidAudioFile = (file: File) => {
    const validTypes = ["audio/wav", "audio/mpeg", "audio/mp3", "audio/m4a", "audio/ogg", "audio/x-wav"];
    return validTypes.includes(file.type) || file.name.match(/\.(wav|mp3|m4a|ogg)$/i);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && isValidAudioFile(file)) {
      setSpeakerFiles(prev => [...prev, { id: crypto.randomUUID(), file, speakerName: "" }]);
    } else if (file) {
      toast.error("Formato não suportado. Use WAV, MP3, M4A ou OGG.");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleMixedFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && isValidAudioFile(file)) {
      setMixedFile(file);
      setAutoMix(false);
    }
    if (mixedFileInputRef.current) mixedFileInputRef.current.value = "";
  };

  const formatSize = (bytes: number) =>
    bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  const mixAudioFiles = useCallback(async (files: File[]): Promise<Blob> => {
    const ctx = new AudioContext({ sampleRate: 48000 });
    const buffers = await Promise.all(files.map(async f => ctx.decodeAudioData(await f.arrayBuffer())));
    const maxLen = Math.max(...buffers.map(b => b.length));
    const mixed = new Float32Array(maxLen);
    for (const buf of buffers) {
      const ch = buf.numberOfChannels;
      for (let c = 0; c < ch; c++) {
        const data = buf.getChannelData(c);
        for (let i = 0; i < data.length; i++) mixed[i] += data[i] / ch;
      }
    }
    const gain = Math.min(1, 1.5 / Math.sqrt(buffers.length));
    for (let i = 0; i < mixed.length; i++) mixed[i] = Math.max(-1, Math.min(1, mixed[i] * gain));
    const pcm = new Int16Array(mixed.length);
    for (let i = 0; i < mixed.length; i++) pcm[i] = mixed[i] < 0 ? mixed[i] * 0x8000 : mixed[i] * 0x7fff;
    const sr = 48000, nc = 1, ds = pcm.length * 2;
    const wav = new ArrayBuffer(44 + ds);
    const v = new DataView(wav);
    const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, "RIFF"); v.setUint32(4, 36 + ds, true); ws(8, "WAVE"); ws(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * nc * 2, true); v.setUint16(32, nc * 2, true);
    v.setUint16(34, 16, true); ws(36, "data"); v.setUint32(40, ds, true);
    for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i], true);
    await ctx.close();
    return new Blob([wav], { type: "audio/wav" });
  }, []);

  const canSubmit = speakerFiles.length >= 2 && speakerFiles.every(sf => sf.speakerName.trim());

  const handleUpload = async () => {
    if (!canSubmit) return;
    setIsUploading(true);
    setUploadProgress(0);
    try {
      const sessionId = crypto.randomUUID();
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const uploaded: { id: string; speakerName: string }[] = [];

      for (let i = 0; i < speakerFiles.length; i++) {
        const sf = speakerFiles[i];
        setUploadProgress(Math.round(((i + 0.5) / speakerFiles.length) * 50));
        setCurrentStep(`Enviando ${sf.speakerName}...`);
        const ext = sf.file.name.split(".").pop() || "wav";
        const fn = `multi_${ts}_${sf.speakerName.replace(/\s+/g, "_")}.${ext}`;
        const path = `uploads/${sessionId}/${fn}`;
        const meta = await getAudioMetadata(sf.file, sf.file.name);
        const { error: ue } = await supabase.storage.from("voice-recordings").upload(path, sf.file);
        if (ue) throw new Error(`Upload falhou para ${sf.speakerName}: ${ue.message}`);
        const { data: urlData } = supabase.storage.from("voice-recordings").getPublicUrl(path);
        const { data: rec, error: ie } = await supabase.from("voice_recordings").insert({
          filename: fn, file_url: urlData.publicUrl, file_size_bytes: sf.file.size,
          duration_seconds: meta.durationSeconds, sample_rate: meta.sampleRate ?? 48000,
          bit_depth: meta.bitDepth ?? 16, channels: meta.channels ?? 2, format: meta.format ?? ext,
          session_id: sessionId, recording_type: "individual", campaign_id: campaignId,
          discord_user_id: `manual_${sf.id}`, discord_username: sf.speakerName,
          discord_guild_id: "manual_upload", discord_guild_name: "Upload Manual",
          discord_channel_id: "multi_speaker", discord_channel_name: "Portal Upload",
          status: "completed", transcription_status: "pending", transcription_elevenlabs_status: "pending",
          metadata: { source: "portal_multi_speaker", original_filename: sf.file.name },
        }).select("id").single();
        if (ie) throw new Error(ie.message);
        uploaded.push({ id: rec.id, speakerName: sf.speakerName });
      }

      setUploadProgress(55);
      let mixBlob: Blob | null = null;
      if (mixedFile) {
        setCurrentStep("Enviando arquivo combinado...");
        mixBlob = mixedFile;
      } else if (autoMix) {
        setCurrentStep("Combinando áudios...");
        mixBlob = await mixAudioFiles(speakerFiles.map(sf => sf.file));
      }

      const mixFn = `session_${ts}.wav`;
      let mixUrl: string | null = null;
      if (mixBlob) {
        const mixPath = `uploads/${sessionId}/${mixFn}`;
        const { error: mue } = await supabase.storage.from("voice-recordings").upload(mixPath, mixBlob);
        if (mue) throw new Error(mue.message);
        const { data: mu } = supabase.storage.from("voice-recordings").getPublicUrl(mixPath);
        mixUrl = mu.publicUrl;
      }
      const mixMeta = mixBlob ? await getAudioMetadata(mixBlob, mixFn) : null;

      setUploadProgress(75);
      setCurrentStep("Registrando sessão...");
      await supabase.from("voice_recordings").insert({
        filename: mixFn, file_url: mixUrl, file_size_bytes: mixBlob?.size ?? null,
        duration_seconds: mixMeta?.durationSeconds ?? null, session_id: sessionId,
        recording_type: "mixed", campaign_id: campaignId,
        discord_user_id: "manual_upload", discord_username: "Multi-Speaker Session",
        discord_guild_id: "manual_upload", discord_guild_name: "Upload Manual",
        discord_channel_id: "multi_speaker", discord_channel_name: "Portal Upload",
        status: "completed", transcription_status: "pending", transcription_elevenlabs_status: "pending",
        sample_rate: mixMeta?.sampleRate ?? 48000, bit_depth: mixMeta?.bitDepth ?? 16,
        channels: mixMeta?.channels ?? 1, format: "wav",
        metadata: {
          source: "portal_multi_speaker",
          mixed_source: mixedFile ? "user_uploaded" : autoMix ? "auto_generated" : "none",
          speakers: speakerFiles.map(sf => ({ username: sf.speakerName, user_id: `manual_${sf.id}` })),
          individual_recordings: uploaded,
        },
      });

      setUploadProgress(90);
      setCurrentStep("Processando áudios...");
      for (const r of uploaded) {
        const { data: rd } = await supabase.from("voice_recordings").select("file_url").eq("id", r.id).single();
        if (rd?.file_url) await supabase.functions.invoke("process-audio", { body: { recording_id: r.id, audio_url: rd.file_url } });
      }

      setUploadProgress(100);
      toast.success("Áudios enviados com sucesso!", { description: `${speakerFiles.length} speakers registrados.` });
      setSpeakerFiles([]);
      setMixedFile(null);
      setAutoMix(true);
      queryClient.invalidateQueries({ queryKey: ["recordings"] });
      onUploadComplete?.();
    } catch (err: any) {
      toast.error("Erro no upload: " + (err.message || "Tente novamente"));
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setCurrentStep("");
    }
  };

  return (
    <div className="space-y-4">
      <input ref={fileInputRef} type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg" onChange={handleFileSelect} className="hidden" />
      <input ref={mixedFileInputRef} type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg" onChange={handleMixedFileSelect} className="hidden" />

      {/* Speaker list */}
      {speakerFiles.length === 0 ? (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full p-8 flex flex-col items-center gap-3 transition-colors"
          style={{ border: "1px dashed var(--portal-border)", background: "var(--portal-input-bg)" }}
        >
          <Mic className="h-6 w-6" style={{ color: "var(--portal-accent)" }} />
          <span className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
            Adicione arquivos de áudio separados por participante
          </span>
        </button>
      ) : (
        <div className="space-y-2">
          {speakerFiles.map((sf, idx) => (
            <div key={sf.id} className="flex items-center gap-3 p-3" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-input-bg)" }}>
              <span className="font-mono text-xs font-bold w-6 text-center" style={{ color: "var(--portal-accent)" }}>{idx + 1}</span>
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <FileAudio className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--portal-text-muted)" }} />
                  <span className="font-mono text-xs truncate" style={{ color: "var(--portal-text)" }}>{sf.file.name}</span>
                  <span className="font-mono text-[10px]" style={{ color: "var(--portal-text-muted)" }}>{formatSize(sf.file.size)}</span>
                </div>
                <input
                  className="portal-brutalist-input w-full text-xs"
                  placeholder="Nome do participante"
                  value={sf.speakerName}
                  onChange={e => setSpeakerFiles(prev => prev.map(s => s.id === sf.id ? { ...s, speakerName: e.target.value } : s))}
                  disabled={isUploading}
                />
              </div>
              {!isUploading && (
                <button onClick={() => setSpeakerFiles(prev => prev.filter(s => s.id !== sf.id))} style={{ color: "var(--portal-text-muted)" }}>
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!isUploading && (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 py-2 font-mono text-xs uppercase tracking-widest transition-colors"
          style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar Participante
        </button>
      )}

      {/* Mixed track options */}
      {speakerFiles.length >= 2 && !isUploading && (
        <div className="p-4 space-y-3" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-input-bg)" }}>
          <div className="flex items-center gap-2">
            <Music className="h-3.5 w-3.5" style={{ color: "var(--portal-accent)" }} />
            <span className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>Áudio Combinado</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setAutoMix(true); setMixedFile(null); }}
              className="font-mono text-xs px-3 py-1.5 transition-colors"
              style={{
                border: `1px solid ${autoMix && !mixedFile ? "var(--portal-accent)" : "var(--portal-border)"}`,
                background: autoMix && !mixedFile ? "var(--portal-accent)" : "transparent",
                color: autoMix && !mixedFile ? "var(--portal-accent-text)" : "var(--portal-text-muted)",
              }}
            >
              Auto-combinar
            </button>
            <button
              onClick={() => mixedFileInputRef.current?.click()}
              className="font-mono text-xs px-3 py-1.5 transition-colors"
              style={{
                border: `1px solid ${mixedFile ? "var(--portal-accent)" : "var(--portal-border)"}`,
                background: mixedFile ? "var(--portal-accent)" : "transparent",
                color: mixedFile ? "var(--portal-accent-text)" : "var(--portal-text-muted)",
              }}
            >
              {mixedFile ? mixedFile.name : "Enviar arquivo"}
            </button>
          </div>
        </div>
      )}

      {/* Progress */}
      {isUploading && (
        <div className="space-y-2 p-4" style={{ border: "1px solid var(--portal-border)" }}>
          <div className="flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "var(--portal-accent)" }} />
            <span className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>{currentStep}</span>
          </div>
          <div className="w-full h-1" style={{ background: "var(--portal-border)" }}>
            <div className="h-full transition-all" style={{ width: `${uploadProgress}%`, background: "var(--portal-accent)" }} />
          </div>
        </div>
      )}

      {/* Submit */}
      {speakerFiles.length >= 2 && (
        <KGenButton
          onClick={handleUpload}
          disabled={!canSubmit || isUploading}
          className="w-full"
          size="default"
          scrambleText={isUploading ? "ENVIANDO..." : "ENVIAR ÁUDIOS"}
          icon={isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        />
      )}
    </div>
  );
}
