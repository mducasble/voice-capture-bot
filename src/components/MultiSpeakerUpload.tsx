import { useState, useRef, useCallback } from "react";
import { Upload, Loader2, FileAudio, X, Plus, Users, Mic, Music } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { getAudioMetadata, type AudioMetadata } from "@/lib/audioMetadata";

interface SpeakerFile {
  id: string;
  file: File;
  speakerName: string;
}

interface MultiSpeakerUploadProps {
  campaignId: string;
  onUploadComplete?: () => void;
}

export function MultiSpeakerUpload({ campaignId, onUploadComplete }: MultiSpeakerUploadProps) {
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
    const validTypes = ["audio/wav", "audio/x-wav"];
    return validTypes.includes(file.type) || file.name.match(/\.wav$/i);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && isValidAudioFile(file)) {
      const newSpeaker: SpeakerFile = {
        id: crypto.randomUUID(),
        file,
        speakerName: "",
      };
      setSpeakerFiles((prev) => [...prev, newSpeaker]);
    } else if (file) {
      toast.error("Arquivo inválido", {
        description: "Formatos suportados: WAV, MP3, M4A, OGG, MKV",
      });
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleMixedFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && isValidAudioFile(file)) {
      setMixedFile(file);
      setAutoMix(false);
    } else if (file) {
      toast.error("Arquivo inválido");
    }
    if (mixedFileInputRef.current) {
      mixedFileInputRef.current.value = "";
    }
  };

  const updateSpeakerName = (id: string, name: string) => {
    setSpeakerFiles((prev) =>
      prev.map((sf) => (sf.id === id ? { ...sf, speakerName: name } : sf))
    );
  };

  const removeSpeakerFile = (id: string) => {
    setSpeakerFiles((prev) => prev.filter((sf) => sf.id !== id));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  /**
   * Mix individual audio files into a single combined WAV using Web Audio API.
   * Decodes all files, mixes them sample-by-sample, and encodes to 48kHz 16-bit mono WAV.
   */
  const mixAudioFiles = useCallback(async (files: File[]): Promise<Blob> => {
    const audioContext = new AudioContext({ sampleRate: 48000 });

    // Decode all files
    const buffers = await Promise.all(
      files.map(async (file) => {
        const arrayBuffer = await file.arrayBuffer();
        return audioContext.decodeAudioData(arrayBuffer);
      })
    );

    // Find the longest duration
    const maxLength = Math.max(...buffers.map((b) => b.length));

    // Mix all buffers into a single mono channel
    const mixed = new Float32Array(maxLength);
    for (const buffer of buffers) {
      const channels = buffer.numberOfChannels;
      for (let ch = 0; ch < channels; ch++) {
        const channelData = buffer.getChannelData(ch);
        for (let i = 0; i < channelData.length; i++) {
          mixed[i] += channelData[i] / channels;
        }
      }
    }

    // Normalize to prevent clipping
    const streamCount = buffers.length;
    const gain = Math.min(1, 1.5 / Math.sqrt(streamCount));
    for (let i = 0; i < mixed.length; i++) {
      mixed[i] = Math.max(-1, Math.min(1, mixed[i] * gain));
    }

    // Convert to 16-bit PCM WAV
    const pcm = new Int16Array(mixed.length);
    for (let i = 0; i < mixed.length; i++) {
      const s = mixed[i];
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    const sampleRate = 48000;
    const numChannels = 1;
    const byteRate = sampleRate * numChannels * 2;
    const blockAlign = numChannels * 2;
    const dataSize = pcm.length * 2;
    const bufferSize = 44 + dataSize;
    const wavBuffer = new ArrayBuffer(bufferSize);
    const view = new DataView(wavBuffer);

    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);

    for (let i = 0; i < pcm.length; i++) {
      view.setInt16(44 + i * 2, pcm[i], true);
    }

    await audioContext.close();
    return new Blob([wavBuffer], { type: "audio/wav" });
  }, []);

  const canSubmit = speakerFiles.length >= 2 && speakerFiles.every((sf) => sf.speakerName.trim());


  const handleUpload = async () => {
    if (!canSubmit) return;

    setIsUploading(true);
    setUploadProgress(0);

    try {
      const sessionId = crypto.randomUUID();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const uploadedRecordings: { id: string; speakerName: string }[] = [];

      // Upload each individual file
      for (let i = 0; i < speakerFiles.length; i++) {
        const sf = speakerFiles[i];
        const progress = Math.round(((i + 0.5) / speakerFiles.length) * 50);
        setUploadProgress(progress);
        setCurrentStep(`Enviando ${sf.speakerName}...`);

        const ext = sf.file.name.split(".").pop() || "wav";
        const filename = `multi_${timestamp}_${sf.speakerName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_\-]/g, "_")}.${ext}`;
        const storagePath = `uploads/${sessionId}/${filename}`;

        const audioMetadata = await getAudioMetadata(sf.file, sf.file.name);

        const { error: uploadError } = await supabase.storage
          .from("voice-recordings")
          .upload(storagePath, sf.file);

        if (uploadError) {
          throw new Error(`Upload falhou para ${sf.speakerName}: ${uploadError.message}`);
        }

        const { data: urlData } = supabase.storage
          .from("voice-recordings")
          .getPublicUrl(storagePath);

        const { data: recording, error: insertError } = await supabase
          .from("voice_recordings")
          .insert({
            filename,
            file_url: urlData.publicUrl,
            file_size_bytes: sf.file.size,
            duration_seconds: audioMetadata.durationSeconds,
            sample_rate: audioMetadata.sampleRate ?? 48000,
            bit_depth: audioMetadata.bitDepth ?? 16,
            channels: audioMetadata.channels ?? 2,
            format: audioMetadata.format ?? ext.toLowerCase(),
            campaign_id: campaignId,
            session_id: sessionId,
            recording_type: "individual",
            discord_user_id: `manual_${sf.id}`,
            discord_username: sf.speakerName,
            discord_guild_id: "manual_upload",
            discord_guild_name: "Upload Manual",
            discord_channel_id: "multi_speaker",
            discord_channel_name: "Multi-Speaker Upload",
            status: "completed",
            transcription_status: "pending",
            transcription_elevenlabs_status: "pending",
            metadata: {
              source: "manual_multi_speaker",
              original_filename: sf.file.name,
            },
          })
          .select("id")
          .single();

        if (insertError) {
          throw new Error(`Registro falhou para ${sf.speakerName}: ${insertError.message}`);
        }

        uploadedRecordings.push({ id: recording.id, speakerName: sf.speakerName });
      }

      // Handle mixed file: user-provided or auto-generated
      setUploadProgress(55);
      let mixedBlob: Blob;
      let mixedFileSize: number;
      let mixedMetadata: AudioMetadata | null = null;

      if (mixedFile) {
        setCurrentStep("Enviando arquivo combinado...");
        mixedBlob = mixedFile;
        mixedFileSize = mixedFile.size;
        mixedMetadata = await getAudioMetadata(mixedFile, mixedFile.name);
      } else if (autoMix) {
        setCurrentStep("Combinando áudios automaticamente...");
        mixedBlob = await mixAudioFiles(speakerFiles.map((sf) => sf.file));
        mixedFileSize = mixedBlob.size;
        mixedMetadata = await getAudioMetadata(mixedBlob, "session_auto_mix.wav");
      } else {
        // No mixed file - create metadata-only record (legacy behavior)
        mixedBlob = null as unknown as Blob;
        mixedFileSize = 0;
      }

      setUploadProgress(65);
      setCurrentStep("Registrando sessão...");

      const mixedFilename = `session_${timestamp}.wav`;
      let mixedFileUrl: string | null = null;

      if (mixedBlob) {
        const mixedStoragePath = `uploads/${sessionId}/${mixedFilename}`;
        const { error: mixUploadError } = await supabase.storage
          .from("voice-recordings")
          .upload(mixedStoragePath, mixedBlob);

        if (mixUploadError) {
          throw new Error(`Upload do áudio combinado falhou: ${mixUploadError.message}`);
        }

        const { data: mixedUrlData } = supabase.storage
          .from("voice-recordings")
          .getPublicUrl(mixedStoragePath);

        mixedFileUrl = mixedUrlData.publicUrl;
      }

      // Create the mixed recording record
      const { error: mixedError } = await supabase
        .from("voice_recordings")
        .insert({
          filename: mixedFilename,
          file_url: mixedFileUrl,
          file_size_bytes: mixedFileSize || null,
          duration_seconds: mixedMetadata?.durationSeconds ?? null,
          campaign_id: campaignId,
          session_id: sessionId,
          recording_type: "mixed",
          discord_user_id: "manual_upload",
          discord_username: "Multi-Speaker Session",
          discord_guild_id: "manual_upload",
          discord_guild_name: "Upload Manual",
          discord_channel_id: "multi_speaker",
          discord_channel_name: "Multi-Speaker Upload",
          status: "completed",
          transcription_status: "pending",
          transcription_elevenlabs_status: "pending",
          sample_rate: mixedMetadata?.sampleRate ?? (mixedBlob ? 48000 : 44100),
          bit_depth: mixedMetadata?.bitDepth ?? 16,
          channels: mixedMetadata?.channels ?? (mixedBlob ? 1 : 2),
          format: mixedMetadata?.format ?? "wav",
          metadata: {
            source: "manual_multi_speaker",
            mixed_source: mixedFile ? "user_uploaded" : autoMix ? "auto_generated" : "none",
            speakers: speakerFiles.map((sf) => ({
              username: sf.speakerName,
              user_id: `manual_${sf.id}`,
              has_transcription: false,
            })),
            individual_recordings: uploadedRecordings,
          },
        })
        .select("id")
        .single();

      if (mixedError) {
        throw new Error(`Criação da sessão falhou: ${mixedError.message}`);
      }

      setUploadProgress(80);
      setCurrentStep("Iniciando processamento de áudio...");

      // Trigger process-audio for each individual recording
      for (const rec of uploadedRecordings) {
        const { data: recData } = await supabase
          .from("voice_recordings")
          .select("file_url")
          .eq("id", rec.id)
          .single();

        if (recData?.file_url) {
          await supabase.functions.invoke("process-audio", {
            body: { recording_id: rec.id, audio_url: recData.file_url },
          });
        }
      }

      setUploadProgress(100);
      setCurrentStep("Concluído!");

      const mixMethod = mixedFile ? "upload manual" : autoMix ? "auto-combinado" : "sem arquivo";
      toast.success("Arquivos enviados com sucesso!", {
        description: `${speakerFiles.length} speakers registrados. Mixed track: ${mixMethod}.`,
      });

      setSpeakerFiles([]);
      setMixedFile(null);
      setAutoMix(true);
      queryClient.invalidateQueries({ queryKey: ["recordings"] });
      onUploadComplete?.();
    } catch (error) {
      console.error("Multi-speaker upload error:", error);
      toast.error("Erro no upload", {
        description: error instanceof Error ? error.message : "Tente novamente",
      });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setCurrentStep("");
    }
  };

  const clearAll = () => {
    setSpeakerFiles([]);
    setMixedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (mixedFileInputRef.current) mixedFileInputRef.current.value = "";
  };

  return (
    <Card className="glass-card border-dashed border-2 border-border/50 hover:border-primary/50 transition-colors">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Users className="h-5 w-5 text-primary" />
          Upload Multi-Speaker
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {speakerFiles.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-6 cursor-pointer rounded-lg hover:bg-muted/50 transition-colors border border-dashed border-border/50"
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="p-3 rounded-full bg-primary/10 mb-3">
              <Mic className="h-6 w-6 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              Adicione arquivos de áudio separados por speaker
              <br />
              <span className="text-xs">Cada arquivo representa um participante da conversa</span>
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {speakerFiles.map((sf, index) => (
              <div
                key={sf.id}
                className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/50"
              >
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-medium">
                  {index + 1}
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <FileAudio className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm truncate">{sf.file.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {formatFileSize(sf.file.size)}
                    </Badge>
                  </div>
                  <Input
                    placeholder="Nome do speaker (ex: João, Maria)"
                    value={sf.speakerName}
                    onChange={(e) => updateSpeakerName(sf.id, e.target.value)}
                    disabled={isUploading}
                    className="h-8 text-sm"
                  />
                </div>
                {!isUploading && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeSpeakerFile(sf.id)}
                    className="text-muted-foreground hover:text-destructive flex-shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".wav,audio/wav,audio/x-wav"
          onChange={handleFileSelect}
          className="hidden"
        />

        <input
          ref={mixedFileInputRef}
          type="file"
          accept=".wav,audio/wav,audio/x-wav"
          onChange={handleMixedFileSelect}
          className="hidden"
        />

        {!isUploading && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus className="h-4 w-4 mr-2" />
            Adicionar Speaker
          </Button>
        )}

        {/* Mixed track options - show when at least 2 speakers added */}
        {speakerFiles.length >= 2 && !isUploading && (
          <div className="space-y-3 p-3 rounded-lg bg-muted/20 border border-border/50">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Music className="h-4 w-4 text-primary" />
                Áudio Combinado (Mixed Track)
              </Label>
            </div>

            {mixedFile ? (
              <div className="flex items-center gap-2 p-2 rounded bg-muted/30">
                <FileAudio className="h-4 w-4 text-primary flex-shrink-0" />
                <span className="text-sm truncate flex-1">{mixedFile.name}</span>
                <Badge variant="outline" className="text-xs">
                  {formatFileSize(mixedFile.size)}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => {
                    setMixedFile(null);
                    setAutoMix(true);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Switch
                    id="auto-mix"
                    checked={autoMix}
                    onCheckedChange={setAutoMix}
                  />
                  <Label htmlFor="auto-mix" className="text-xs text-muted-foreground cursor-pointer">
                    Combinar automaticamente os áudios individuais
                  </Label>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => mixedFileInputRef.current?.click()}
                >
                  <Upload className="h-3 w-3 mr-1" />
                  Ou enviar arquivo combinado manualmente
                </Button>
              </div>
            )}
          </div>
        )}

        {isUploading && (
          <div className="space-y-2">
            <Progress value={uploadProgress} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">{currentStep}</p>
          </div>
        )}

        {speakerFiles.length > 0 && (
          <div className="flex gap-2">
            <Button
              onClick={handleUpload}
              disabled={isUploading || !canSubmit}
              className="flex-1"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processando...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Enviar {speakerFiles.length} Arquivos
                </>
              )}
            </Button>
            {!isUploading && (
              <Button variant="outline" onClick={clearAll}>
                Limpar
              </Button>
            )}
          </div>
        )}

        {speakerFiles.length > 0 && speakerFiles.length < 2 && (
          <p className="text-xs text-amber-500 text-center">
            Adicione pelo menos 2 speakers para criar uma sessão
          </p>
        )}

        {speakerFiles.length >= 2 && !speakerFiles.every((sf) => sf.speakerName.trim()) && (
          <p className="text-xs text-amber-500 text-center">
            Preencha o nome de todos os speakers
          </p>
        )}

        <p className="text-xs text-muted-foreground text-center">
          Após o upload, use "Agregar Transcrições" no card da sessão para gerar o JSON organizado
        </p>
      </CardContent>
    </Card>
  );
}
