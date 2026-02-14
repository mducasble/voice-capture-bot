import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Radio, Mic, MicOff, Users, Copy, Check, Square, Circle, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ParticipantAudio } from "@/components/rooms/ParticipantAudio";
import { AudioTestFlow } from "@/components/rooms/AudioTestFlow";

interface Room {
  id: string;
  creator_name: string;
  room_name: string | null;
  status: string;
  session_id: string;
  is_recording: boolean;
  noise_gate_enabled: boolean;
  recording_started_at: string | null;
  created_at: string;
}

interface Participant {
  id: string;
  room_id: string;
  name: string;
  is_creator: boolean;
  is_connected: boolean;
  joined_at: string;
  audio_test_status: string;
  audio_test_results: any;
}

const Room = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  
  const [room, setRoom] = useState<Room | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [currentParticipant, setCurrentParticipant] = useState<Participant | null>(null);
  const [joinName, setJoinName] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [audioEnhanced, setAudioEnhanced] = useState(false);
  
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Enumerate audio input devices
  useEffect(() => {
    const loadDevices = async () => {
      try {
        // Need to request permission first to get device labels
        await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop()));
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === "audioinput");
        setAudioDevices(audioInputs);
        if (audioInputs.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(audioInputs[0].deviceId);
        }
      } catch (e) {
        console.error("Error enumerating devices:", e);
      }
    };
    loadDevices();

    navigator.mediaDevices.addEventListener("devicechange", loadDevices);
    return () => navigator.mediaDevices.removeEventListener("devicechange", loadDevices);
  }, []);

  // Helper to get audio constraints with selected device
  const getAudioConstraints = useCallback(() => ({
    audio: {
      deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
      echoCancellation: audioEnhanced,
      noiseSuppression: audioEnhanced,
      autoGainControl: audioEnhanced,
      sampleRate: 48000,
    }
  }), [selectedDeviceId, audioEnhanced]);

  // Switch device while connected
  const handleDeviceChange = useCallback(async (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    if (!currentParticipant) return;

    // Replace the active stream
    try {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: audioEnhanced,
          noiseSuppression: audioEnhanced,
          autoGainControl: audioEnhanced,
          sampleRate: 48000,
        }
      });
      // Apply mute state
      stream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
      mediaStreamRef.current = stream;
      // Force re-render to pass new stream to ParticipantAudio
      setCurrentParticipant(prev => prev ? { ...prev } : null);
      toast.success("Dispositivo alterado!");
    } catch (err) {
      console.error("Error switching device:", err);
      toast.error("Erro ao trocar dispositivo");
    }
  }, [currentParticipant, isMuted, audioEnhanced]);

  // Toggle audio enhancement and re-acquire stream
  const handleToggleEnhancement = useCallback(async (enabled: boolean) => {
    setAudioEnhanced(enabled);
    if (!currentParticipant || !mediaStreamRef.current) return;

    try {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
          echoCancellation: enabled,
          noiseSuppression: enabled,
          autoGainControl: enabled,
          sampleRate: 48000,
        }
      });
      stream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
      mediaStreamRef.current = stream;
      setCurrentParticipant(prev => prev ? { ...prev } : null);
      toast.success(enabled ? "Aprimoramento de áudio ativado!" : "Aprimoramento de áudio desativado!");
    } catch (err) {
      console.error("Error toggling enhancement:", err);
      toast.error("Erro ao alterar aprimoramento de áudio");
    }
  }, [currentParticipant, selectedDeviceId, isMuted]);

  // Fetch room data
  useEffect(() => {
    if (!roomId) return;

    const fetchRoom = async () => {
      const { data, error } = await supabase
        .from("rooms")
        .select("*")
        .eq("id", roomId)
        .single();

      if (error || !data) {
        toast.error("Sala não encontrada");
        navigate("/rooms");
        return;
      }

      setRoom(data as Room);
    };

    fetchRoom();
  }, [roomId, navigate]);

  // Check if current user is the creator and auto-connect
  useEffect(() => {
    if (!roomId || !room) return;

    const checkCreatorParticipant = async () => {
      const { data: creatorParticipant } = await supabase
        .from("room_participants")
        .select("*")
        .eq("room_id", roomId)
        .eq("is_creator", true)
        .single();

      if (creatorParticipant && !currentParticipant) {
        const storedCreatorId = sessionStorage.getItem(`room_${roomId}_participant`);
        if (storedCreatorId === creatorParticipant.id) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia(getAudioConstraints());
            mediaStreamRef.current = stream;
            setCurrentParticipant(creatorParticipant as Participant);
          } catch (error) {
            console.error("Error getting microphone:", error);
          }
        }
      }
    };

    checkCreatorParticipant();
  }, [roomId, room, currentParticipant, getAudioConstraints]);

  // Fetch and subscribe to participants
  useEffect(() => {
    if (!roomId) return;

    const fetchParticipants = async () => {
      const { data } = await supabase
        .from("room_participants")
        .select("*")
        .eq("room_id", roomId)
        .eq("is_connected", true);

      if (data) setParticipants(data as Participant[]);
    };

    fetchParticipants();

    // Subscribe to realtime changes
    const channel = supabase
      .channel(`room-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_participants", filter: `room_id=eq.${roomId}` },
        () => fetchParticipants()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        (payload) => setRoom(payload.new as Room)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  // Recording duration timer
  useEffect(() => {
    if (room?.is_recording && room.recording_started_at) {
      const startTime = new Date(room.recording_started_at).getTime();
      
      durationIntervalRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setRecordingDuration(elapsed);
      }, 1000);
    } else {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      setRecordingDuration(0);
    }

    return () => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    };
  }, [room?.is_recording, room?.recording_started_at]);

  // Handle joining room (for non-creators or creator first time)
  const handleJoin = async (asCreator = false) => {
    if (!asCreator && !joinName.trim()) {
      toast.error("Digite seu nome");
      return;
    }
    if (!roomId) return;

    setIsJoining(true);
    try {
      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia(getAudioConstraints());
      mediaStreamRef.current = stream;

      if (asCreator) {
        // Creator joining - find their existing participant record
        const { data: creatorParticipant } = await supabase
          .from("room_participants")
          .select("*")
          .eq("room_id", roomId)
          .eq("is_creator", true)
          .single();

        if (creatorParticipant) {
          // Store in sessionStorage for reconnection
          sessionStorage.setItem(`room_${roomId}_participant`, creatorParticipant.id);
          setCurrentParticipant(creatorParticipant as Participant);
          toast.success("Conectado à sala!");
          return;
        }
      }

      // Add new participant to database
      const { data, error } = await supabase
        .from("room_participants")
        .insert({
          room_id: roomId,
          name: joinName.trim(),
          is_creator: false,
        })
        .select()
        .single();

      if (error) throw error;

      // Store in sessionStorage for reconnection
      sessionStorage.setItem(`room_${roomId}_participant`, data.id);
      setCurrentParticipant(data as Participant);
      toast.success("Conectado à sala!");
    } catch (error: any) {
      console.error("Error joining:", error);
      if (error.name === "NotAllowedError") {
        toast.error("Permissão de microfone negada");
      } else {
        toast.error("Erro ao entrar na sala");
      }
    } finally {
      setIsJoining(false);
    }
  };

  // Start recording (creator only)
  const handleStartRecording = async () => {
    if (!room || !roomId) return;

    await supabase
      .from("rooms")
      .update({ 
        is_recording: true, 
        status: "recording",
        recording_started_at: new Date().toISOString()
      })
      .eq("id", roomId);

    toast.success("Gravação iniciada!");
  };

  // Stop recording (creator only)
  const handleStopRecording = async () => {
    if (!room || !roomId) return;

    await supabase
      .from("rooms")
      .update({ 
        is_recording: false, 
        status: "completed"
      })
      .eq("id", roomId);

    toast.success("Gravação finalizada! Processando uploads...");
  };

  // Copy room link
  const copyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Link copiado!");
    setTimeout(() => setCopied(false), 2000);
  };

  // Toggle mute
  const toggleMute = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = isMuted;
      });
      setIsMuted(!isMuted);
    }
  };

  // Format duration
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Leave room
  const handleLeave = async () => {
    if (currentParticipant) {
      await supabase
        .from("room_participants")
        .update({ is_connected: false, left_at: new Date().toISOString() })
        .eq("id", currentParticipant.id);
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
    }

    navigate("/rooms");
  };

  if (!room) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Carregando sala...</div>
      </div>
    );
  }

  // Check if user might be the creator
  const isCreatorName = room.creator_name;

  // Join screen
  if (!currentParticipant) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto p-3 rounded-full bg-primary/10 w-fit mb-2">
              <Radio className="h-8 w-8 text-primary" />
            </div>
            <CardTitle>{room.room_name || `Sala de ${room.creator_name}`}</CardTitle>
            <CardDescription>
              Criada por {room.creator_name} • {participants.length} participante(s)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Audio device selector */}
            {audioDevices.length > 1 && (
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Mic className="h-4 w-4" /> Dispositivo de Áudio
                </label>
                <Select value={selectedDeviceId} onValueChange={setSelectedDeviceId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o microfone" />
                  </SelectTrigger>
                  <SelectContent>
                    {audioDevices.map((device) => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>
                        {device.label || `Microfone ${audioDevices.indexOf(device) + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Creator quick join button */}
            <Button 
              className="w-full" 
              variant="default"
              onClick={() => handleJoin(true)}
              disabled={isJoining}
            >
              {isJoining ? "Conectando..." : `Entrar como ${isCreatorName} (Criador)`}
            </Button>
            
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">ou entre como participante</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Seu Nome</label>
              <Input
                placeholder="Digite seu nome para entrar"
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleJoin(false)}
              />
            </div>
            <Button 
              className="w-full" 
              variant="outline"
              onClick={() => handleJoin(false)}
              disabled={isJoining || !joinName.trim()}
            >
              {isJoining ? "Conectando..." : "Entrar como Participante"}
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              Será solicitada permissão para acessar seu microfone
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Room view
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Radio className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">
                {room.room_name || `Sala de ${room.creator_name}`}
              </h1>
              <div className="flex items-center gap-2">
                <Badge variant={room.is_recording ? "destructive" : "secondary"}>
                  {room.is_recording ? (
                    <span className="flex items-center gap-1">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                      </span>
                      Gravando {formatDuration(recordingDuration)}
                    </span>
                  ) : (
                    room.status === "completed" ? "Finalizada" : "Aguardando"
                  )}
                </Badge>
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {participants.length}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={copyLink}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLeave}>
              Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-8 max-w-2xl space-y-6">
        {/* Audio Test Flow */}
        {!room.is_recording && room.status !== "completed" && (
          <AudioTestFlow
            participantId={currentParticipant.id}
            participantName={currentParticipant.name}
            roomId={room.id}
            stream={mediaStreamRef.current}
            testStatus={currentParticipant.audio_test_status || "pending"}
            testResults={currentParticipant.audio_test_results}
            onTestComplete={() => {
              // Refresh participants to get updated test status
              const fetchParticipants = async () => {
                const { data } = await supabase
                  .from("room_participants")
                  .select("*")
                  .eq("room_id", roomId)
                  .eq("is_connected", true);
                if (data) {
                  setParticipants(data as Participant[]);
                  const me = data.find((p: any) => p.id === currentParticipant.id);
                  if (me) setCurrentParticipant(me as Participant);
                }
              };
              fetchParticipants();
            }}
          />
        )}

        {/* Recording Controls (Creator only) */}
        {currentParticipant.is_creator && (
          <Card>
            <CardContent className="py-4 space-y-4">
              {(() => {
                const allPassed = participants.every(p => p.audio_test_status === "passed");
                const pendingNames = participants.filter(p => p.audio_test_status !== "passed").map(p => p.name);
                return (
                  <>
                    <div className="flex items-center justify-center gap-4">
                      {!room.is_recording ? (
                        <div className="flex flex-col items-center gap-2">
                          <Button 
                            size="lg" 
                            onClick={handleStartRecording}
                            className="bg-red-600 hover:bg-red-700"
                            disabled={room.status === "completed" || !allPassed}
                          >
                            <Circle className="h-5 w-5 mr-2 fill-current" />
                            Iniciar Gravação
                          </Button>
                          {!allPassed && (
                            <p className="text-xs text-muted-foreground text-center">
                              Aguardando teste de áudio: {pendingNames.join(", ")}
                            </p>
                          )}
                        </div>
                      ) : (
                        <Button 
                          size="lg" 
                          variant="outline"
                          onClick={handleStopRecording}
                        >
                          <Square className="h-5 w-5 mr-2 fill-current" />
                          Parar Gravação
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center justify-center gap-6 pt-2 border-t border-border/50">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                        <label htmlFor="noise-gate" className="text-sm text-muted-foreground cursor-pointer">
                          Noise Gate
                        </label>
                        <Switch
                          id="noise-gate"
                          checked={room.noise_gate_enabled}
                          disabled={room.is_recording}
                          onCheckedChange={async (checked) => {
                            await supabase
                              .from("rooms")
                              .update({ noise_gate_enabled: checked })
                              .eq("id", roomId);
                          }}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-muted-foreground" />
                        <label htmlFor="audio-enhance" className="text-sm text-muted-foreground cursor-pointer">
                          Aprimorar Áudio
                        </label>
                        <Switch
                          id="audio-enhance"
                          checked={audioEnhanced}
                          disabled={room.is_recording}
                          onCheckedChange={handleToggleEnhancement}
                        />
                      </div>
                    </div>
                  </>
                );
              })()}
            </CardContent>
          </Card>
        )}

        {/* My Audio */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Seu Áudio</span>
              <Button 
                variant={isMuted ? "destructive" : "outline"} 
                size="sm"
                onClick={toggleMute}
              >
                {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Device selector */}
            {audioDevices.length > 1 && (
              <Select value={selectedDeviceId} onValueChange={handleDeviceChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione o microfone" />
                </SelectTrigger>
                <SelectContent>
                  {audioDevices.map((device) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label || `Microfone ${audioDevices.indexOf(device) + 1}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <ParticipantAudio
              participantId={currentParticipant.id}
              participantName={currentParticipant.name}
              stream={mediaStreamRef.current}
              isRecording={room.is_recording}
              sessionId={room.session_id}
              isMuted={isMuted}
              noiseGateEnabled={room.noise_gate_enabled}
              audioEnhanced={audioEnhanced}
            />
          </CardContent>
        </Card>

        {/* Participants */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Participantes ({participants.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {participants.map((p) => (
                <div 
                  key={p.id} 
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${p.is_connected ? "bg-green-500" : "bg-gray-400"}`} />
                    <span className="font-medium">{p.name}</span>
                    {p.is_creator && (
                      <Badge variant="outline" className="text-xs">Criador</Badge>
                    )}
                    {p.id === currentParticipant.id && (
                      <Badge variant="secondary" className="text-xs">Você</Badge>
                    )}
                    {p.audio_test_status === "passed" && (
                      <Badge variant="outline" className="text-xs border-green-500/50 text-green-500">✅ Teste OK</Badge>
                    )}
                    {p.audio_test_status === "failed" && (
                      <Badge variant="outline" className="text-xs border-red-500/50 text-red-500">❌ Teste</Badge>
                    )}
                    {p.audio_test_status === "testing" && (
                      <Badge variant="outline" className="text-xs border-yellow-500/50 text-yellow-500">⏳ Testando</Badge>
                    )}
                  </div>
                  <Mic className="h-4 w-4 text-muted-foreground" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Room;
