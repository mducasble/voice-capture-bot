import { useState, useRef } from "react";
import { Upload, Loader2, FileAudio, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { getAudioMetadata } from "@/lib/audioMetadata";

interface AudioUploadProps {
  onUploadComplete?: () => void;
  transcriptionOnly?: boolean;
}

export function AudioUpload({ onUploadComplete, transcriptionOnly = false }: AudioUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    if (file && isValidAudioFile(file)) {
      setSelectedFile(file);
    } else {
      toast.error("Por favor, selecione um arquivo de áudio válido (WAV, MP3, M4A, OGG, MKV)");
    }
  };

  const isValidAudioFile = (file: File) => {
    const validTypes = ["audio/wav", "audio/mpeg", "audio/mp3", "audio/m4a", "audio/ogg", "audio/x-wav", "video/x-matroska", "audio/x-matroska"];
    return validTypes.includes(file.type) || file.name.match(/\.(wav|mp3|m4a|ogg|mkv)$/i);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && isValidAudioFile(file)) {
      setSelectedFile(file);
    } else if (file) {
      toast.error("Por favor, selecione um arquivo de áudio válido (WAV, MP3, M4A, OGG, MKV)");
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setUploadProgress(10);

    try {
      const audioMetadata = await getAudioMetadata(selectedFile, selectedFile.name);

      // Generate unique filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const ext = selectedFile.name.split(".").pop() || "wav";
      const filename = `upload_${timestamp}.${ext}`;
      const storagePath = `uploads/${filename}`;

      setUploadProgress(20);

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from("voice-recordings")
        .upload(storagePath, selectedFile);

      if (uploadError) {
        throw new Error(`Upload failed: ${uploadError.message}`);
      }

      setUploadProgress(50);

      // Get public URL
      const { data: urlData } = supabase.storage
        .from("voice-recordings")
        .getPublicUrl(storagePath);

      const fileUrl = urlData.publicUrl;

      setUploadProgress(60);

      // Call edge function to register and process
      const { data, error } = await supabase.functions.invoke("upload-transcribe", {
        body: {
          filename,
          file_url: fileUrl,
          file_size_bytes: selectedFile.size,
          original_filename: selectedFile.name,
          transcription_only: transcriptionOnly,
          duration_seconds: audioMetadata.durationSeconds,
          sample_rate: audioMetadata.sampleRate,
          bit_depth: audioMetadata.bitDepth,
          channels: audioMetadata.channels,
          format: audioMetadata.format,
        },
      });

      if (error) {
        throw error;
      }

      setUploadProgress(100);
      
      toast.success("Áudio enviado! Transcrições iniciadas.", {
        description: "Gemini e ElevenLabs processando em paralelo",
      });

      // Reset state
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      // Refresh recordings list
      queryClient.invalidateQueries({ queryKey: ["recordings"] });
      onUploadComplete?.();
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Erro no upload", {
        description: error instanceof Error ? error.message : "Tente novamente",
      });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const clearSelection = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <Card className="glass-card border-dashed border-2 border-border/50 hover:border-primary/50 transition-colors">
      <CardContent className="p-6">
        {!selectedFile ? (
          <div
            className={`flex flex-col items-center justify-center py-8 cursor-pointer rounded-lg transition-colors ${
              isDragging ? "bg-primary/10" : "hover:bg-muted/50"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="p-4 rounded-full bg-primary/10 mb-4">
              <Upload className="h-8 w-8 text-primary" />
            </div>
            <h4 className="text-lg font-medium text-foreground mb-2">
              Enviar Áudio para Transcrição
            </h4>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              Arraste um arquivo ou clique para selecionar.
              <br />
              Formatos suportados: WAV, MP3, M4A, OGG, MKV
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/x-matroska,.wav,.mp3,.m4a,.ogg,.mkv"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-primary/10">
                <FileAudio className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground truncate">
                  {selectedFile.name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatFileSize(selectedFile.size)}
                </p>
              </div>
              {!isUploading && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={clearSelection}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            {isUploading && (
              <div className="space-y-2">
                <Progress value={uploadProgress} className="h-2" />
                <p className="text-xs text-muted-foreground text-center">
                  {uploadProgress < 50
                    ? "Enviando arquivo..."
                    : uploadProgress < 80
                    ? "Registrando gravação..."
                    : "Iniciando transcrições..."}
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleUpload}
                disabled={isUploading}
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
                    Enviar e Transcrever
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              O áudio será transcrito com Gemini e ElevenLabs automaticamente
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
