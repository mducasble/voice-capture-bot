import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { Radio, Mic, MicOff, Users, Copy, Check, Square, Circle, Volume2, MessageSquare, Timer } from "lucide-react";
import KGenButton from "@/components/portal/KGenButton";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ParticipantAudio } from "@/components/rooms/ParticipantAudio";
import { AudioTestFlow } from "@/components/rooms/AudioTestFlow";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useMixedRecorder } from "@/hooks/useMixedRecorder";
import { RecordingGuidelinesSidebar } from "@/components/rooms/RecordingGuidelinesSidebar";
import type { AudioProfile } from "@/lib/audioProfile";

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
  topic: string | null;
  duration_minutes: number | null;
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
  user_id?: string | null;
}

const Room = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isPortal = !location.pathname.startsWith("/admin");
  const searchParams = new URLSearchParams(location.search);
  const campaignId = searchParams.get("campaign") || undefined;
  const refCode = searchParams.get("ref") || undefined;

  // Store referral code from room invite link
  useEffect(() => {
    if (refCode) {
      localStorage.setItem("referral_code", refCode);
    }
  }, [refCode]);
  
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
  const [audioProfile, setAudioProfile] = useState<AudioProfile | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [dbCreatorParticipant, setDbCreatorParticipant] = useState<Participant | null>(null);
  
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const remoteAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [isMixedUploading, setIsMixedUploading] = useState(false);
  const [mixedUploadProgress, setMixedUploadProgress] = useState(0);

  // Mixed recorder for creator
  const mixedRecorder = useMixedRecorder();

  // WebRTC peer-to-peer audio
  const { remoteStreams } = useWebRTC({
    roomId,
    participantId: currentParticipant?.id,
    localStream,
    participants,
  });

  // Play remote audio streams
  useEffect(() => {
    remoteStreams.forEach((stream, peerId) => {
      let audioEl = remoteAudioRefs.current.get(peerId);
      if (!audioEl) {
        audioEl = new Audio();
        audioEl.autoplay = true;
        remoteAudioRefs.current.set(peerId, audioEl);
      }
      if (audioEl.srcObject !== stream) {
        audioEl.srcObject = stream;
        audioEl.play().catch(e => console.warn("[WebRTC] Audio play failed:", e));
      }
    });

    // Clean up removed peers
    remoteAudioRefs.current.forEach((audioEl, peerId) => {
      if (!remoteStreams.has(peerId)) {
        audioEl.srcObject = null;
        remoteAudioRefs.current.delete(peerId);
      }
    });
  }, [remoteStreams]);

  // Add new remote streams to mixed recorder mid-recording
  useEffect(() => {
    if (!mixedRecorder.isRecording) return;
    remoteStreams.forEach((stream) => {
      mixedRecorder.addRemoteStream(stream);
    });
    // We only want to react to new streams appearing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteStreams.size]);

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
  const getAudioConstraints = useCallback(() => {
    return {
      audio: {
        deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
        echoCancellation: audioProfile?.enableEchoCancellation ?? false,
        noiseSuppression: audioProfile?.enableNoiseSuppression ?? false,
        autoGainControl: audioProfile?.enableAutoGainControl ?? false,
        sampleRate: 48000,
      }
    };
  }, [selectedDeviceId, audioProfile]);

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
          echoCancellation: audioProfile?.enableEchoCancellation ?? false,
          noiseSuppression: audioProfile?.enableNoiseSuppression ?? false,
          autoGainControl: audioProfile?.enableAutoGainControl ?? false,
          sampleRate: 48000,
        }
      });
      // Apply mute state
      stream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
      mediaStreamRef.current = stream;
      setLocalStream(stream);
      // Force re-render to pass new stream to ParticipantAudio
      setCurrentParticipant(prev => prev ? { ...prev } : null);
      toast.success("Dispositivo alterado!");
    } catch (err) {
      console.error("Error switching device:", err);
      toast.error("Erro ao trocar dispositivo");
    }
  }, [currentParticipant, isMuted, audioProfile]);

  // Handle profile application - re-acquire stream with new constraints
  const handleProfileApplied = useCallback(async (profile: AudioProfile) => {
    setAudioProfile(profile);
    if (!currentParticipant || !mediaStreamRef.current) return;

    try {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
          echoCancellation: profile.enableEchoCancellation,
          noiseSuppression: profile.enableNoiseSuppression,
          autoGainControl: profile.enableAutoGainControl,
          sampleRate: 48000,
        }
      });
      stream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
      mediaStreamRef.current = stream;
      setLocalStream(stream);
      setCurrentParticipant(prev => prev ? { ...prev } : null);
    } catch (err) {
      console.error("Error applying audio profile:", err);
      toast.error("Erro ao aplicar configuração de áudio");
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
        navigate(isPortal ? "/" : "/admin/rooms");
        return;
      }

      setRoom(data as Room);
    };

    fetchRoom();
  }, [roomId, navigate]);

  // Fetch creator participant from DB (including disconnected ones)
  useEffect(() => {
    if (!roomId) return;
    const fetchCreator = async () => {
      const { data } = await supabase
        .from("room_participants")
        .select("*")
        .eq("room_id", roomId)
        .eq("is_creator", true)
        .single();
      if (data) setDbCreatorParticipant(data as Participant);
    };
    fetchCreator();
  }, [roomId]);

  // Check if current user is the creator and auto-connect
  useEffect(() => {
    if (!roomId || !room || !dbCreatorParticipant) return;

    const checkCreatorParticipant = async () => {
      if (!currentParticipant) {
        const currentUser = (await supabase.auth.getUser()).data.user;
        const isUserCreator = currentUser && dbCreatorParticipant.user_id === currentUser.id;
        const storedCreatorId = localStorage.getItem(`room_${roomId}_participant`);
        if (storedCreatorId === dbCreatorParticipant.id || isUserCreator) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia(getAudioConstraints());
            mediaStreamRef.current = stream;
            setLocalStream(stream);

            // Re-mark as connected in DB
            await supabase
              .from("room_participants")
              .update({ is_connected: true, left_at: null })
              .eq("id", dbCreatorParticipant.id);

            setCurrentParticipant(dbCreatorParticipant);
          } catch (error) {
            console.error("Error getting microphone:", error);
          }
        }
      }
    };

    checkCreatorParticipant();
  }, [roomId, room, dbCreatorParticipant, currentParticipant, getAudioConstraints]);

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
  const handleJoin = async (asCreator = false, anonymous = false) => {
    if (!asCreator && !anonymous && !joinName.trim()) {
      toast.error("Digite seu nome");
      return;
    }
    if (!roomId) return;
    const participantName = anonymous ? "Anônimo" : joinName.trim();
    if (!roomId) return;

    setIsJoining(true);
    try {
      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia(getAudioConstraints());
      mediaStreamRef.current = stream;
      setLocalStream(stream);

      if (asCreator) {
        // Creator joining - find their existing participant record
        const { data: creatorParticipant } = await supabase
          .from("room_participants")
          .select("*")
          .eq("room_id", roomId)
          .eq("is_creator", true)
          .single();

        if (creatorParticipant) {
          // Re-mark as connected in DB
          await supabase
            .from("room_participants")
            .update({ is_connected: true, left_at: null })
            .eq("id", creatorParticipant.id);

          // Store in localStorage for reconnection
          localStorage.setItem(`room_${roomId}_participant`, creatorParticipant.id);
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
          name: participantName,
          is_creator: false,
          user_id: (await supabase.auth.getUser()).data.user?.id || null,
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

    // Start mixed recording if creator has a local stream
    if (currentParticipant?.is_creator && mediaStreamRef.current) {
      await mixedRecorder.startRecording(mediaStreamRef.current, remoteStreams);
    }

    await supabase
      .from("rooms")
      .update({ 
        is_recording: true, 
        status: "live",
        recording_started_at: new Date().toISOString()
      })
      .eq("id", roomId);

    toast.success("Gravação iniciada!");
  };

  // Upload mixed recording
  const uploadMixedRecording = async (wavBlob: Blob) => {
    if (!room || !wavBlob || wavBlob.size === 0) return;

    setIsMixedUploading(true);
    setMixedUploadProgress(0);
    const filename = `room_${room.session_id}_mixed_${Date.now()}.wav`;

    try {
      setMixedUploadProgress(10);
      const formData = new FormData();
      formData.append("audio", wavBlob, filename);
      formData.append("filename", filename);
      formData.append("session_id", room.session_id);
      formData.append("participant_id", currentParticipant?.id || "mixed");
      formData.append("participant_name", "Mixed");
      formData.append("recording_type", "mixed");
      formData.append("format", "wav");
      if (campaignId) formData.append("campaign_id", campaignId);

      setMixedUploadProgress(30);
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-room-recording`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${authToken}`,
          },
          body: formData,
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Upload failed: ${errText}`);
      }

      setMixedUploadProgress(100);
      toast.success("Áudio mixado enviado!");
    } catch (error) {
      console.error("Mixed upload error:", error);
      toast.error("Erro ao enviar áudio mixado. Salvando localmente...");
      // Fallback: save locally so the recording isn't lost
      try {
        const url = URL.createObjectURL(wavBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success("Arquivo salvo localmente como fallback!");
      } catch (dlErr) {
        console.error("Local save also failed:", dlErr);
        toast.error("Não foi possível salvar localmente");
      }
    } finally {
      setIsMixedUploading(false);
    }
  };

  // Stop recording (creator only)
  const handleStopRecording = async () => {
    if (!room || !roomId) return;

    // Stop mixed recording and upload
    if (currentParticipant?.is_creator && mixedRecorder.isRecording) {
      const mixedBlob = await mixedRecorder.stopRecording();
      if (mixedBlob) {
        uploadMixedRecording(mixedBlob);
      }
    }

    await supabase
      .from("rooms")
      .update({ 
        is_recording: false, 
        status: "completed"
      })
      .eq("id", roomId);

    toast.success("Gravação finalizada! Processando uploads...");
  };

  // Copy room link with referral code
  const copyLink = async () => {
    const url = new URL(window.location.href);
    
    // Try to get current user's referral code
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("referral_code")
          .eq("id", user.id)
          .single();
        if (profile?.referral_code) {
          url.searchParams.set("ref", profile.referral_code);
        }
      }
    } catch (e) {
      console.warn("Could not fetch referral code:", e);
    }
    
    navigator.clipboard.writeText(url.toString());
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

      // If creator leaves and room never recorded, mark as "lost"
      if (currentParticipant.is_creator && room && !room.is_recording && room.status !== "completed") {
        await supabase
          .from("rooms")
          .update({ status: "lost" })
          .eq("id", room.id);
      }
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }

    navigate(isPortal ? "/" : "/admin/rooms");
  };

  if (!room) {
    return (
      <div className={isPortal ? "" : "min-h-screen bg-background flex items-center justify-center"}>
        {isPortal ? (
          <div className="flex items-center justify-center py-32">
            <div className="animate-pulse font-mono text-sm uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>Carregando sala...</div>
          </div>
        ) : (
          <div className="animate-pulse text-muted-foreground">Carregando sala...</div>
        )}
      </div>
    );
  }

    // Check if user might be the creator via sessionStorage
    const storedParticipantId = roomId ? sessionStorage.getItem(`room_${roomId}_participant`) : null;
    // Check participants list first, but also check DB-fetched creator (may be disconnected)
    const creatorParticipant = participants.find(p => p.is_creator) || dbCreatorParticipant;
    const isLikelyCreator = !!(storedParticipantId && creatorParticipant && storedParticipantId === creatorParticipant.id);

    // Join screen
    if (!currentParticipant) {
      if (isPortal) {
        return (
          <div className="max-w-md mx-auto space-y-6">
            <div className="text-center space-y-2">
              <div className="inline-flex items-center justify-center w-16 h-16 mb-2" style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}>
                <Radio className="h-8 w-8" />
              </div>
              <h2 className="font-mono text-2xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
                {room.room_name || `Sala de ${room.creator_name}`}
              </h2>
              <p className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
                Criada por {room.creator_name} • {participants.length} participante(s)
              </p>
            </div>

            <div className="space-y-4 p-6" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
              {audioDevices.length > 1 && (
                <div className="space-y-2">
                  <label className="font-mono text-xs uppercase tracking-widest flex items-center gap-2" style={{ color: "var(--portal-text-muted)" }}>
                    <Mic className="h-3.5 w-3.5" /> Dispositivo de Áudio
                  </label>
                  <Select value={selectedDeviceId} onValueChange={setSelectedDeviceId}>
                    <SelectTrigger className="portal-brutalist-input h-11">
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

              {isLikelyCreator && (
                <>
                  <KGenButton
                    className="w-full"
                    onClick={() => handleJoin(true)}
                    disabled={isJoining}
                    scrambleText={isJoining ? "CONECTANDO..." : `ENTRAR COMO ${room.creator_name.toUpperCase()}`}
                  />
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full" style={{ borderTop: "1px solid var(--portal-border)" }} />
                    </div>
                    <div className="relative flex justify-center">
                      <span className="px-3 font-mono text-[10px] uppercase tracking-widest" style={{ background: "var(--portal-input-bg)", color: "var(--portal-text-muted)" }}>
                        ou entre como participante
                      </span>
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-2">
                <label className="font-mono text-xs uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>Seu Nome</label>
                <input
                  className="portal-brutalist-input w-full"
                  placeholder="Digite seu nome para entrar"
                  value={joinName}
                  onChange={(e) => setJoinName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleJoin(false)}
                />
              </div>
              <KGenButton
                variant="dark"
                className="w-full"
                onClick={() => handleJoin(false)}
                disabled={isJoining || !joinName.trim()}
                scrambleText={isJoining ? "CONECTANDO..." : "ENTRAR COMO PARTICIPANTE"}
              />

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full" style={{ borderTop: "1px solid var(--portal-border)" }} />
                </div>
                <div className="relative flex justify-center">
                  <span className="px-3 font-mono text-[10px] uppercase tracking-widest" style={{ background: "var(--portal-input-bg)", color: "var(--portal-text-muted)" }}>
                    ou
                  </span>
                </div>
              </div>

              <KGenButton
                variant="outline"
                className="w-full"
                onClick={() => handleJoin(false, true)}
                disabled={isJoining}
                scrambleText={isJoining ? "CONECTANDO..." : "ENTRAR ANÔNIMO"}
              />

              <p className="font-mono text-[10px] text-center" style={{ color: "var(--portal-text-muted)" }}>
                Será solicitada permissão para acessar seu microfone
              </p>
            </div>
          </div>
        );
      }

      // Original non-portal join screen
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

              {isLikelyCreator && (
                <>
                  <Button 
                    className="w-full" 
                    variant="default"
                    onClick={() => handleJoin(true)}
                    disabled={isJoining}
                  >
                    {isJoining ? "Conectando..." : `Entrar como ${room.creator_name} (Criador)`}
                  </Button>
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">ou entre como participante</span>
                    </div>
                  </div>
                </>
              )}

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
  if (isPortal) {
    // Portal-themed room view
    return (
      <div className="space-y-6">
        <RecordingGuidelinesSidebar />
        {/* Portal Room Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-3 h-3" style={{ background: room.is_recording ? "hsl(0 84% 60%)" : "var(--portal-accent)" }} />
              <span className="font-mono text-xs tracking-[0.3em] uppercase" style={{ color: room.is_recording ? "hsl(0 84% 60%)" : "var(--portal-accent)" }}>
                {room.is_recording ? `Gravando ${formatDuration(recordingDuration)}` : room.status === "completed" ? "Finalizada" : "Aguardando"}
              </span>
            </div>
            <h1 className="font-mono text-2xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
              {room.room_name || `Sala de ${room.creator_name}`}
            </h1>
            <div className="flex items-center gap-4 mt-1">
              <p className="font-mono text-xs flex items-center gap-2" style={{ color: "var(--portal-text-muted)" }}>
                <Users className="h-3 w-3" /> {participants.length} participante(s)
              </p>
              {room.topic && (
                <p className="font-mono text-xs flex items-center gap-1.5" style={{ color: "var(--portal-accent)" }}>
                  <MessageSquare className="h-3 w-3" /> {room.topic}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copyLink}
              className="p-2 font-mono text-xs uppercase transition-colors"
              style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
            <KGenButton variant="dark" size="sm" onClick={handleLeave} scrambleText="SAIR" />
          </div>
        </div>

        <div className="flex gap-6" style={{ maxWidth: "1200px", margin: "0 auto" }}>
          {/* LEFT COLUMN - Controls (30%) */}
          <div className="space-y-4" style={{ width: "33%" }}>
            {/* Audio Test Flow */}
            {!room.is_recording && room.status !== "completed" && (
              <AudioTestFlow
                participantId={currentParticipant.id}
                participantName={currentParticipant.name}
                roomId={room.id}
                stream={mediaStreamRef.current}
                testStatus={currentParticipant.audio_test_status || "pending"}
                testResults={currentParticipant.audio_test_results}
                onProfileRecommended={handleProfileApplied}
                currentProfile={audioProfile}
                isPortal={isPortal}
                onTestComplete={() => {
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
              <div className="p-4 space-y-3" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
                <div className="flex items-center justify-center">
                  {!room.is_recording ? (
                    <KGenButton
                      onClick={handleStartRecording}
                      disabled={room.status === "completed"}
                      scrambleText="INICIAR GRAVAÇÃO"
                      icon={<Circle className="h-4 w-4 fill-current" />}
                      className="w-full"
                    />
                  ) : (
                    <KGenButton
                      variant="dark"
                      onClick={handleStopRecording}
                      scrambleText="PARAR GRAVAÇÃO"
                      icon={<Square className="h-4 w-4 fill-current" />}
                      className="w-full"
                    />
                  )}
                </div>
                {isMixedUploading && (
                  <div className="space-y-1">
                    <div className="flex justify-between font-mono text-[10px]" style={{ color: "var(--portal-text-muted)" }}>
                      <span>ENVIANDO ÁUDIO...</span>
                      <span>{mixedUploadProgress}%</span>
                    </div>
                    <Progress value={mixedUploadProgress} className="h-1" />
                  </div>
                )}
                <div className="flex items-center justify-center gap-3 pt-2 font-mono text-[10px]" style={{ borderTop: "1px solid var(--portal-border)" }}>
                  {audioProfile && (
                    <span className="px-2 py-0.5" style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}>
                      🎛️ PERFIL ADAPTATIVO
                    </span>
                  )}
                  {room.is_recording && (
                    <span className="px-2 py-0.5" style={{ border: "1px solid var(--portal-border)", color: "var(--portal-accent)" }}>
                      🎚️ MIX: {1 + remoteStreams.size} STREAMS
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Participants */}
            <div style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
              <div className="p-3" style={{ borderBottom: "1px solid var(--portal-border)" }}>
                <span className="font-mono text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--portal-text)" }}>
                  Participantes ({participants.length})
                </span>
              </div>
              <div className="p-3 space-y-1.5">
                {participants.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-2"
                    style={{ border: "1px solid var(--portal-border)" }}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2" style={{ background: p.is_connected ? "var(--portal-accent)" : "var(--portal-text-muted)" }} />
                      <span className="font-mono text-xs font-bold" style={{ color: "var(--portal-text)" }}>{p.name}</span>
                      {p.is_creator && (
                        <span className="font-mono text-[9px] px-1.5 py-0.5 uppercase" style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}>
                          Criador
                        </span>
                      )}
                      {p.id === currentParticipant.id && (
                        <span className="font-mono text-[9px] px-1.5 py-0.5 uppercase" style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}>
                          Você
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {p.audio_test_status === "passed" && <span className="text-[10px]">✅</span>}
                      {p.audio_test_status === "failed" && <span className="text-[10px]">❌</span>}
                      {p.audio_test_status === "testing" && <span className="text-[10px]">⏳</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* My Audio */}
            <div style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
              <div className="p-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--portal-border)" }}>
                <span className="font-mono text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--portal-text)" }}>Seu Áudio</span>
                <button
                  onClick={toggleMute}
                  className="p-1.5 transition-colors"
                  style={{
                    border: "1px solid var(--portal-border)",
                    color: isMuted ? "hsl(0 84% 60%)" : "var(--portal-text-muted)",
                    background: isMuted ? "hsl(0 84% 60% / 0.1)" : "transparent",
                  }}
                >
                  {isMuted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                </button>
              </div>
              <div className="p-3 space-y-2">
                {audioDevices.length > 1 && (
                  <Select value={selectedDeviceId} onValueChange={handleDeviceChange}>
                    <SelectTrigger className="portal-brutalist-input h-8 text-xs">
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
                  noiseGateEnabled={audioProfile?.enableNoiseGate ?? false}
                  audioProfile={audioProfile}
                  campaignId={campaignId}
                />
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN - Content (67%) */}
          <div className="space-y-4" style={{ width: "67%" }}>
            {/* Countdown Timer */}
            {room.duration_minutes && (() => {
              if (room.is_recording && room.recording_started_at) {
                const totalSeconds = room.duration_minutes * 60;
                const remaining = Math.max(0, totalSeconds - recordingDuration);
                const mins = Math.floor(remaining / 60);
                const secs = remaining % 60;
                const pct = ((totalSeconds - remaining) / totalSeconds) * 100;
                const isLow = remaining <= 60;
                return (
                  <div className="p-6 text-center space-y-3" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
                    <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
                      Tempo restante
                    </span>
                    <p className="font-mono text-7xl font-black tabular-nums leading-none" style={{ color: isLow ? "hsl(0 84% 60%)" : "var(--portal-accent)" }}>
                      {mins.toString().padStart(2, "0")}:{secs.toString().padStart(2, "0")}
                    </p>
                    <div className="w-full h-1.5" style={{ background: "var(--portal-border)" }}>
                      <div className="h-full transition-all duration-1000" style={{ width: `${pct}%`, background: isLow ? "hsl(0 84% 60%)" : "var(--portal-accent)" }} />
                    </div>
                  </div>
                );
              }
              if (!room.is_recording && room.status !== "completed") {
                return (
                  <div className="p-6 text-center space-y-2" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
                    <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
                      Tempo de conversa
                    </span>
                    <p className="font-mono text-7xl font-black tabular-nums leading-none" style={{ color: "var(--portal-accent)" }}>
                      {room.duration_minutes.toString().padStart(2, "0")}:00
                    </p>
                  </div>
                );
              }
              return null;
            })()}

            {/* Topic display */}
            {room.topic && (
              <div className="p-4" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
                <span className="font-mono text-[10px] uppercase tracking-widest block mb-2" style={{ color: "var(--portal-text-muted)" }}>
                  Tema da Conversa
                </span>
                <p className="font-mono text-lg font-bold uppercase" style={{ color: "var(--portal-text)" }}>
                  {room.topic}
                </p>
              </div>
            )}

            {/* Script / Talking Points placeholder */}
            <div className="p-4 flex-1" style={{ border: "1px dashed var(--portal-border)", background: "var(--portal-card-bg)", minHeight: "200px" }}>
              <span className="font-mono text-[10px] uppercase tracking-widest block mb-3" style={{ color: "var(--portal-text-muted)" }}>
                Roteiro / Pontos de Conversa
              </span>
              <p className="font-mono text-xs leading-relaxed" style={{ color: "var(--portal-text-muted)" }}>
                Nenhum roteiro definido para esta sala.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Original non-portal room view
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
            onProfileRecommended={handleProfileApplied}
            currentProfile={audioProfile}
            onTestComplete={() => {
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
                            disabled={room.status === "completed"}
                          >
                            <Circle className="h-5 w-5 mr-2 fill-current" />
                            Iniciar Gravação
                          </Button>
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
                    {isMixedUploading && (
                      <div className="space-y-1 px-2">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Enviando áudio mixado...</span>
                          <span>{mixedUploadProgress}%</span>
                        </div>
                        <Progress value={mixedUploadProgress} className="h-1" />
                      </div>
                    )}
                    <div className="flex items-center justify-center gap-6 pt-2 border-t border-border/50">
                      {audioProfile && (
                        <Badge variant="outline" className="text-xs border-primary/50 text-primary">
                          🎛️ Perfil Adaptativo
                        </Badge>
                      )}
                      {room.is_recording && (
                        <Badge variant="outline" className="text-xs border-accent/50 text-accent">
                          🎚️ Mix: {1 + remoteStreams.size} streams
                        </Badge>
                      )}
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
              noiseGateEnabled={audioProfile?.enableNoiseGate ?? false}
              audioProfile={audioProfile}
              campaignId={campaignId}
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
                  <div className="flex items-center gap-1">
                    <Mic className="h-4 w-4 text-muted-foreground" />
                    {p.id !== currentParticipant.id && remoteStreams.has(p.id) && (
                      <Volume2 className="h-4 w-4 text-green-500" />
                    )}
                  </div>
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
