import { useState, useRef } from "react";
import { Upload, Loader2, FileAudio, X, Plus, Users, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface SpeakerFile {
  id: string;
  file: File;
  speakerName: string;
}

interface MultiSpeakerUploadProps {
  onUploadComplete?: () => void;
}

export function MultiSpeakerUpload({ onUploadComplete }: MultiSpeakerUploadProps) {
  const [speakerFiles, setSpeakerFiles] = useState<SpeakerFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const isValidAudioFile = (file: File) => {
    const validTypes = ["audio/wav", "audio/mpeg", "audio/mp3", "audio/m4a", "audio/ogg", "audio/x-wav", "video/x-matroska", "audio/x-matroska"];
    return validTypes.includes(file.type) || file.name.match(/\.(wav|mp3|m4a|ogg|mkv)$/i);
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
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
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

  const canSubmit = speakerFiles.length >= 2 && speakerFiles.every((sf) => sf.speakerName.trim());

  const handleUpload = async () => {
    if (!canSubmit) return;

    setIsUploading(true);
    setUploadProgress(0);

    try {
      const sessionId = crypto.randomUUID();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const uploadedRecordings: { id: string; speakerName: string }[] = [];

      // Upload each file and register as individual recording
      for (let i = 0; i < speakerFiles.length; i++) {
        const sf = speakerFiles[i];
        const progress = Math.round(((i + 0.5) / speakerFiles.length) * 70);
        setUploadProgress(progress);
        setCurrentStep(`Enviando ${sf.speakerName}...`);

        const ext = sf.file.name.split(".").pop() || "wav";
        const filename = `multi_${timestamp}_${sf.speakerName.replace(/\s+/g, "_")}.${ext}`;
        const storagePath = `uploads/${sessionId}/${filename}`;

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from("voice-recordings")
          .upload(storagePath, sf.file);

        if (uploadError) {
          throw new Error(`Upload falhou para ${sf.speakerName}: ${uploadError.message}`);
        }

        // Get public URL
        const { data: urlData } = supabase.storage
          .from("voice-recordings")
          .getPublicUrl(storagePath);

        // Register as individual recording
        const { data: recording, error: insertError } = await supabase
          .from("voice_recordings")
          .insert({
            filename,
            file_url: urlData.publicUrl,
            file_size_bytes: sf.file.size,
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

      setUploadProgress(75);
      setCurrentStep("Criando registro principal...");

      // Create the "mixed" recording that will hold the aggregated transcription
      const { data: mixedRecording, error: mixedError } = await supabase
        .from("voice_recordings")
        .insert({
          filename: `session_${timestamp}.wav`,
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
          metadata: {
            source: "manual_multi_speaker",
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

      setUploadProgress(85);
      setCurrentStep("Iniciando processamento de áudio...");

      // Trigger process-audio for each individual recording to generate chunks
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

      toast.success("Arquivos enviados com sucesso!", {
        description: `${speakerFiles.length} speakers registrados. Use "Agregar Transcrições" após o processamento.`,
      });

      // Reset state
      setSpeakerFiles([]);
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
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
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
          accept="audio/*,video/x-matroska,.wav,.mp3,.m4a,.ogg,.mkv"
          onChange={handleFileSelect}
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
