import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { Radio, Mic, MicOff, Users, Copy, Check, Square, Circle, Volume2, MessageSquare, Timer, AlertCircle, Loader2, ShieldAlert, Lightbulb, Download, RotateCw, LogIn, XCircle, Globe } from "lucide-react";
import { AudioLevelIndicator } from "@/components/rooms/AudioLevelIndicator";
import KGenButton from "@/components/portal/KGenButton";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";

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
import { useDaily } from "@/hooks/useDaily";
import { useMixedRecorder } from "@/hooks/useMixedRecorder";
import { useRemoteRecorders } from "@/hooks/useRemoteRecorders";
import { RecordingGuidelinesSidebar } from "@/components/rooms/RecordingGuidelinesSidebar";
import { TalkingPointsBlock } from "@/components/rooms/TalkingPointsBlock";


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
  is_public?: boolean;
  creator_user_id?: string | null;
}

interface JoinRequest {
  id: string;
  room_id: string;
  user_id: string;
  user_name: string;
  status: string;
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
  user_id?: string | null;
}

const Room = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation("translation");
  const isPortal = !location.pathname.startsWith("/admin");
  const searchParams = new URLSearchParams(location.search);
  const campaignId = searchParams.get("campaign") || undefined;
  const refCode = searchParams.get("ref") || undefined;

  // Store referral code from room invite link and process immediately if user is already logged in
  useEffect(() => {
    if (refCode) {
      localStorage.setItem("referral_code", refCode);
      // If user is already authenticated, process referral now
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          import("@/hooks/useReferral").then(({ processReferralOnSignup }) => {
            processReferralOnSignup(user.id);
          });
        }
      });
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
  
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [dbCreatorParticipant, setDbCreatorParticipant] = useState<Participant | null>(null);
  
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const remoteAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const remoteGainContexts = useRef<Map<string, { ctx: AudioContext; gain: GainNode }>>(new Map());
  const [isMixedUploading, setIsMixedUploading] = useState(false);
  const [mixedUploadProgress, setMixedUploadProgress] = useState(0);
  const [remoteUploadsInProgress, setRemoteUploadsInProgress] = useState(0);
  const [remoteUploadsDone, setRemoteUploadsDone] = useState(0);
  const [uploadOverlayHold, setUploadOverlayHold] = useState(false);
  const [savedBlobs, setSavedBlobs] = useState<Map<string, { blob: Blob; label: string }>>(new Map());
  const [overlayStartedAt, setOverlayStartedAt] = useState<number | null>(null);
  const [overlayElapsed, setOverlayElapsed] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const nonCreatorUploadedRef = useRef<string | null>(null);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [joinRequestRejected, setJoinRequestRejected] = useState(false);

  // Fetch campaign admin rules for min participants check
  const { data: campaignAdminRules } = useQuery({
    queryKey: ["campaign-admin-rules", campaignId],
    queryFn: async () => {
      if (!campaignId) return null;
      const { data, error } = await supabase
        .from("campaign_administrative_rules")
        .select("min_participants_per_session")
        .eq("campaign_id", campaignId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!campaignId,
  });

  const minParticipants = campaignAdminRules?.min_participants_per_session ?? null;
  const connectedCount = participants.filter(p => p.is_connected).length;
  const canStartRecording = minParticipants == null || connectedCount >= minParticipants;

  // Mixed recorder for creator
  const mixedRecorder = useMixedRecorder();

  // Remote individual recorders (creator records each remote stream as backup)
  const remoteRecorders = useRemoteRecorders();

  // Daily should only connect when: not awaiting approval for public rooms
  const dailyEnabled = !awaitingApproval && !joinRequestRejected;

  // Daily.co SFU audio connection (replaces P2P WebRTC)
  const { remoteStreams, peerStatuses, isDailyConnected, leaveDaily, rejoinDaily } = useDaily({
    roomId,
    participantId: currentParticipant?.id,
    localStream,
    participants,
    enabled: dailyEnabled,
  });

  // Idle timer: 5 minutes to start recording or Daily disconnects
  const IDLE_TIMEOUT_SECONDS = 5 * 60;
  const [idleSecondsLeft, setIdleSecondsLeft] = useState<number | null>(null);
  const [idleTimedOut, setIdleTimedOut] = useState(false);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Start idle timer when Daily connects, clear when recording starts
  useEffect(() => {
    if (isDailyConnected && !room?.is_recording && room?.status !== "completed" && room?.status !== "expired" && !idleTimedOut) {
      setIdleSecondsLeft(IDLE_TIMEOUT_SECONDS);
      idleTimerRef.current = setInterval(() => {
        setIdleSecondsLeft(prev => {
          if (prev === null) return null;
          if (prev <= 1) {
            clearInterval(idleTimerRef.current!);
            setIdleTimedOut(true);
            leaveDaily();
            // Close room in DB as expired + save idle time
            if (roomId) {
              supabase
                .from("rooms")
                .update({
                  status: "expired",
                  is_recording: false,
                  idle_seconds_before_recording: IDLE_TIMEOUT_SECONDS,
                } as any)
                .eq("id", roomId)
                .then(() => {
                  // Mark all participants as disconnected
                  supabase
                    .from("room_participants")
                    .update({ is_connected: false, left_at: new Date().toISOString() })
                    .eq("room_id", roomId)
                    .then(() => {});
                });
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else if (room?.is_recording) {
      // Recording started, clear idle timer
      if (idleTimerRef.current) clearInterval(idleTimerRef.current);
      setIdleSecondsLeft(null);
      setIdleTimedOut(false);
    }

    return () => {
      if (idleTimerRef.current) clearInterval(idleTimerRef.current);
    };
  }, [isDailyConnected, room?.is_recording, room?.status, idleTimedOut, leaveDaily, roomId]);

  const handleReopenDaily = useCallback(async () => {
    if (!roomId) return;
    // Reactivate room in DB
    await supabase
      .from("rooms")
      .update({ status: "active" } as any)
      .eq("id", roomId);
    // Re-mark current participant as connected
    if (currentParticipant) {
      await supabase
        .from("room_participants")
        .update({ is_connected: true, left_at: null })
        .eq("id", currentParticipant.id);
    }
    setIdleTimedOut(false);
    setIdleSecondsLeft(IDLE_TIMEOUT_SECONDS);
    await rejoinDaily();
  }, [rejoinDaily, roomId, currentParticipant]);

  // ===== Join Requests (for public rooms) =====
  const isCreator = currentParticipant?.is_creator === true;

  const fetchJoinRequests = useCallback(async () => {
    if (!roomId || !isCreator) return;
    const { data } = await supabase
      .from("room_join_requests")
      .select("*")
      .eq("room_id", roomId)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    setJoinRequests((data as JoinRequest[]) || []);
  }, [roomId, isCreator]);

  useEffect(() => {
    fetchJoinRequests();
  }, [fetchJoinRequests]);

  // Realtime: listen for new join requests
  useEffect(() => {
    if (!roomId || !isCreator) return;
    const channel = supabase
      .channel(`join-requests-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_join_requests", filter: `room_id=eq.${roomId}` },
        () => fetchJoinRequests()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [roomId, isCreator, fetchJoinRequests]);

  const handleApproveJoin = async (req: JoinRequest) => {
    // 1. Update request status
    await supabase.from("room_join_requests")
      .update({ status: "approved", reviewed_at: new Date().toISOString() })
      .eq("id", req.id);
    // 2. Add as participant
    await supabase.from("room_participants").insert({
      room_id: req.room_id,
      name: req.user_name,
      is_creator: false,
      user_id: req.user_id,
    });
    toast.success(`${req.user_name} aprovado!`);
    fetchJoinRequests();
  };

  const handleRejectJoin = async (req: JoinRequest) => {
    await supabase.from("room_join_requests")
      .update({ status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("id", req.id);
    toast.info(`${req.user_name} recusado.`);
    fetchJoinRequests();
  };

  // Realtime: participant listens for their own join request approval/rejection
  useEffect(() => {
    if (!roomId || !awaitingApproval) return;

    const checkApproval = async () => {
      const currentUser = (await supabase.auth.getUser()).data.user;
      if (!currentUser) return;

      const channel = supabase
        .channel(`my-join-request-${roomId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "room_join_requests", filter: `room_id=eq.${roomId}` },
          async (payload) => {
            const row = payload.new as any;
            if (row.user_id !== currentUser.id) return;

            if (row.status === "approved") {
              // Host approved — now find our participant record (host created it)
              const { data: myParticipant } = await supabase
                .from("room_participants")
                .select("*")
                .eq("room_id", roomId)
                .eq("user_id", currentUser.id)
                .eq("is_creator", false)
                .single();

              if (myParticipant) {
                localStorage.setItem(`room_${roomId}_participant`, myParticipant.id);
                setCurrentParticipant(myParticipant as Participant);
                setAwaitingApproval(false);
                toast.success("Aprovado! Conectando ao áudio...");
              }
            } else if (row.status === "rejected") {
              setAwaitingApproval(false);
              setJoinRequestRejected(true);
              // Stop mic since we won't connect
              if (mediaStreamRef.current) {
                mediaStreamRef.current.getTracks().forEach(t => t.stop());
                mediaStreamRef.current = null;
                setLocalStream(null);
              }
              toast.error("Sua solicitação foi recusada pelo host.");
            }
          }
        )
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    };

    const cleanup = checkApproval();
    return () => { cleanup.then(fn => fn?.()); };
  }, [roomId, awaitingApproval]);


  // IMPORTANT: Uses createMediaElementSource to route through a SINGLE playback
  // path. Previously, audio was played BOTH through the <audio> element AND a
  // separate AudioContext→destination, which broke the browser's echo cancellation
  // (AEC only references the <audio> element output, not extra AudioContext outputs).
  useEffect(() => {
    remoteStreams.forEach((stream, peerId) => {
      let audioEl = remoteAudioRefs.current.get(peerId);
      if (!audioEl) {
        audioEl = new Audio();
        audioEl.autoplay = true;
        // crossOrigin not needed for MediaStream sources
        remoteAudioRefs.current.set(peerId, audioEl);
      }
      if (audioEl.srcObject !== stream) {
        // Clean up previous gain context for this peer first
        const existing = remoteGainContexts.current.get(peerId);
        if (existing) {
          try { existing.ctx.close(); } catch {}
          remoteGainContexts.current.delete(peerId);
        }

        audioEl.srcObject = stream;
        audioEl.play().catch(e => console.warn("[WebRTC] Audio play failed:", e));

        // Use createMediaElementSource to take ownership of the <audio> output.
        // This routes playback through the AudioContext (with gain) as the ONLY
        // output path, so the browser's AEC can properly cancel it from the mic input.
        try {
          const ctx = new AudioContext();
          const source = ctx.createMediaElementSource(audioEl);
          const gain = ctx.createGain();
          gain.gain.value = 2.5; // 2.5x volume boost for remote audio
          source.connect(gain);
          gain.connect(ctx.destination);
          remoteGainContexts.current.set(peerId, { ctx, gain });
          console.log(`[WebRTC] Applied 2.5x volume boost (single path) for ${peerId}`);
        } catch (e) {
          // Fallback: if AudioContext fails, at least the <audio> element plays at 1x
          console.warn("[WebRTC] Failed to create gain node, falling back to native playback:", e);
        }
      }
    });

    // Clean up removed peers
    remoteAudioRefs.current.forEach((audioEl, peerId) => {
      if (!remoteStreams.has(peerId)) {
        audioEl.srcObject = null;
        remoteAudioRefs.current.delete(peerId);
        const gainCtx = remoteGainContexts.current.get(peerId);
        if (gainCtx) {
          try { gainCtx.ctx.close(); } catch {}
          remoteGainContexts.current.delete(peerId);
        }
      }
    });
  }, [remoteStreams]);

  // Add new remote streams to mixed recorder and remote recorders mid-recording
  useEffect(() => {
    if (!mixedRecorder.isRecording) return;
    remoteStreams.forEach((stream, peerId) => {
      mixedRecorder.addRemoteStream(stream, peerId);
      // Find participant name for this peer
      const participant = participants.find(p => p.id === peerId);
      remoteRecorders.addRemoteStream(peerId, stream, participant?.name || peerId);
    });
    // We only want to react to new streams appearing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteStreams.size]);

  // ALL participants: start remote recorders when recording begins
  // This covers both creator (if streams arrive after clicking Record) and non-creator
  useEffect(() => {
    if (
      room?.is_recording &&
      currentParticipant &&
      remoteStreams.size > 0 &&
      !remoteRecorders.isRecording
    ) {
      console.log("[Room] Starting remote recorders for cross-backup (participant:", currentParticipant.id, "streams:", remoteStreams.size, ")");
      remoteRecorders.startRecording(remoteStreams, participants);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.is_recording, remoteStreams.size, remoteRecorders.isRecording]);

  // Non-creator: stop remote recorders and upload when recording ends
  // (Creator handles this in handleStopRecording directly)
  useEffect(() => {
    if (
      room?.status === "completed" &&
      !room.is_recording &&
      currentParticipant &&
      !currentParticipant.is_creator &&
      remoteRecorders.isRecording &&
      nonCreatorUploadedRef.current !== room.session_id
    ) {
      nonCreatorUploadedRef.current = room.session_id;
      (async () => {
        setUploadOverlayHold(true);
        const remoteBlobs = await remoteRecorders.stopRecording();
        if (remoteBlobs.size > 0) {
          const newBlobs = new Map<string, { blob: Blob; label: string }>();
          remoteBlobs.forEach(({ blob, participantName }, peerId) => {
            newBlobs.set(`remote_${peerId}`, { blob, label: `Backup - ${participantName}` });
          });
          setSavedBlobs(newBlobs);

          // Save to IndexedDB
          for (const [peerId, { blob }] of remoteBlobs) {
            try {
              const { saveBlob } = await import("@/lib/audioIndexedDB");
              await saveBlob(`${room.session_id}_remote_${peerId}`, blob);
            } catch (e) { console.warn("[IndexedDB] Save failed:", e); }
          }

          setRemoteUploadsInProgress(remoteBlobs.size);
          setRemoteUploadsDone(0);
          const uploadPromises: Promise<void>[] = [];
          for (const [peerId, { blob, participantName }] of remoteBlobs) {
            const p = uploadRemoteBackup(peerId, blob, participantName).finally(() => {
              setRemoteUploadsDone(prev => {
                const next = prev + 1;
                if (next >= remoteBlobs.size) {
                  setTimeout(() => { setRemoteUploadsInProgress(0); setRemoteUploadsDone(0); }, 2000);
                }
                return next;
              });
            });
            uploadPromises.push(p);
          }
          await Promise.allSettled(uploadPromises);
        }
        // Don't auto-dismiss — user will dismiss manually
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.status, room?.is_recording, currentParticipant?.is_creator, remoteRecorders.isRecording]);

  // Overlay elapsed timer
  useEffect(() => {
    const isActive = isMixedUploading || remoteUploadsInProgress > 0 || uploadOverlayHold;
    if (isActive && !overlayStartedAt) {
      setOverlayStartedAt(Date.now());
    }
    if (!isActive && overlayStartedAt) {
      setOverlayStartedAt(null);
      setOverlayElapsed(0);
    }
  }, [isMixedUploading, remoteUploadsInProgress, uploadOverlayHold, overlayStartedAt]);

  useEffect(() => {
    if (!overlayStartedAt) return;
    const interval = setInterval(() => {
      setOverlayElapsed(Math.floor((Date.now() - overlayStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [overlayStartedAt]);

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

  // Helper to get audio constraints with selected device — browser processing enabled
  // to match the quality of WebRTC-processed streams in the mixed recording
  const getAudioConstraints = useCallback(() => {
    return {
      audio: {
        deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000,
      }
    };
  }, [selectedDeviceId]);

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
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
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
  }, [currentParticipant, isMuted]);

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

  // Auto-reconnect non-creator participants on refresh
  useEffect(() => {
    if (!roomId || !room || currentParticipant) return;
    // Skip if we already handled creator reconnection
    if (dbCreatorParticipant) {
      const storedId = localStorage.getItem(`room_${roomId}_participant`);
      if (storedId === dbCreatorParticipant.id) return;
    }

    const reconnectParticipant = async () => {
      const storedParticipantId = localStorage.getItem(`room_${roomId}_participant`);
      if (!storedParticipantId) return;

      // Verify participant exists in DB and belongs to this room
      const { data: existingParticipant } = await supabase
        .from("room_participants")
        .select("*")
        .eq("id", storedParticipantId)
        .eq("room_id", roomId)
        .single();

      if (!existingParticipant) {
        // Stale localStorage entry, clear it
        localStorage.removeItem(`room_${roomId}_participant`);
        return;
      }

      // Also verify user_id matches if authenticated
      const currentUser = (await supabase.auth.getUser()).data.user;
      if (currentUser && existingParticipant.user_id && existingParticipant.user_id !== currentUser.id) {
        localStorage.removeItem(`room_${roomId}_participant`);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia(getAudioConstraints());
        mediaStreamRef.current = stream;
        setLocalStream(stream);

        // Re-mark as connected in DB
        await supabase
          .from("room_participants")
          .update({ is_connected: true, left_at: null })
          .eq("id", existingParticipant.id);

        setCurrentParticipant(existingParticipant as Participant);
        toast.success("Reconectado à sala!");
      } catch (error) {
        console.error("Error reconnecting participant:", error);
      }
    };

    reconnectParticipant();
  }, [roomId, room, dbCreatorParticipant, currentParticipant, getAudioConstraints]);

  // Fetch and subscribe to participants (with polling fallback)
  useEffect(() => {
    if (!roomId) return;
    let isMounted = true;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const fetchParticipants = async () => {
      const { data, error } = await supabase
        .from("room_participants")
        .select("*")
        .eq("room_id", roomId)
        .eq("is_connected", true);

      if (error) {
        // Handle JWT expiry gracefully
        const msg = (error as any)?.message || '';
        if (msg.includes('JWT expired') || (error as any)?.code === 'PGRST303') {
          console.warn("[Room] JWT expired during participant fetch, refreshing…");
          await supabase.auth.refreshSession();
        }
        return;
      }

      if (data && isMounted) setParticipants(data as Participant[]);
    };

    // Also poll room data for resilience
    const fetchRoom = async () => {
      const { data } = await supabase
        .from("rooms")
        .select("*")
        .eq("id", roomId)
        .single();
      if (data && isMounted) setRoom(data as Room);
    };

    fetchParticipants();

    // Polling fallback: re-fetch participants every 5s
    const startPolling = () => {
      const poll = () => {
        if (!isMounted) return;
        fetchParticipants().then(() => {
          // Also refresh room state every other poll
          fetchRoom();
          if (isMounted) {
            pollTimer = setTimeout(poll, 5000);
          }
        });
      };
      pollTimer = setTimeout(poll, 5000);
    };

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
        (payload) => { if (isMounted) setRoom(payload.new as Room); }
      )
      .subscribe((status) => {
        console.log(`[Room] Realtime subscription status: ${status}`);
        // Always start polling as fallback
        startPolling();
      });

    // Start polling immediately in case subscription takes time
    startPolling();

    return () => {
      isMounted = false;
      if (pollTimer) clearTimeout(pollTimer);
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

  // Prevent tab close while uploads are in progress
  useEffect(() => {
    const isUploading = isMixedUploading || remoteUploadsInProgress > 0 || uploadOverlayHold;
    if (!isUploading) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isMixedUploading, remoteUploadsInProgress, uploadOverlayHold]);


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

      // Public room: submit join request instead of direct join
      if (room?.is_public && !asCreator) {
        const currentUser = (await supabase.auth.getUser()).data.user;
        const userId = currentUser?.id;
        if (!userId) {
          toast.error("Você precisa estar logado para entrar em salas públicas");
          return;
        }

        const { error: reqError } = await supabase.from("room_join_requests").insert({
          room_id: roomId,
          user_id: userId,
          user_name: participantName,
        });

        if (reqError) {
          if (reqError.code === "23505") {
            toast.info("Solicitação já enviada, aguardando aprovação...");
          } else {
            throw reqError;
          }
        }

        setAwaitingApproval(true);
        toast.success("Solicitação enviada! Aguardando aprovação do host...");
        return;
      }

      // Private room: add participant directly
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

      // Store in localStorage for reconnection
      localStorage.setItem(`room_${roomId}_participant`, data.id);
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

    // ALL participants start recording remote streams as cross-backup
    if (remoteStreams.size > 0 && !remoteRecorders.isRecording) {
      await remoteRecorders.startRecording(remoteStreams, participants);
    }

    // Calculate idle seconds (time spent connected before recording)
    const elapsedIdle = idleSecondsLeft != null ? IDLE_TIMEOUT_SECONDS - idleSecondsLeft : null;

    await supabase
      .from("rooms")
      .update({ 
        is_recording: true, 
        status: "live",
        recording_started_at: new Date().toISOString(),
        idle_seconds_before_recording: elapsedIdle,
      } as any)
      .eq("id", roomId);

    toast.success("Gravação iniciada!");
  };

  // Upload recording directly to S3 via pre-signed URL, then register in DB
  const uploadViaPresignedUrl = async (
    wavBlob: Blob,
    filename: string,
    participantId: string,
    participantName: string,
    recordingType: string,
    onProgress?: (pct: number) => void,
    actualSampleRate?: number,
  ) => {
    const { data: { session } } = await supabase.auth.getSession();
    const authToken = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    onProgress?.(10);

    // 2. Upload via streaming proxy (avoids S3 CORS issues)
    const streamUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stream-upload-to-s3?filename=${encodeURIComponent(filename)}&session_id=${encodeURIComponent(room!.session_id)}&content_type=${encodeURIComponent("audio/wav")}`;
    const streamRes = await fetch(streamUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${authToken}`,
        "Content-Type": "audio/wav",
      },
      body: wavBlob,
    });

    if (!streamRes.ok) {
      const errText = await streamRes.text();
      console.error("[Upload] Stream proxy failed:", errText);
      throw new Error(`Stream upload failed: ${streamRes.status}`);
    }

    const { public_url: finalUrl } = await streamRes.json();

    onProgress?.(70);

    // 3. Register the recording in the database
    const regRes = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/register-room-recording`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filename,
          file_url: finalUrl,
          file_size_bytes: wavBlob.size,
          session_id: room!.session_id,
          participant_id: participantId,
          participant_name: participantName,
          recording_type: recordingType,
          format: "wav",
          campaign_id: campaignId || null,
          sample_rate: actualSampleRate || 48000,
        }),
      }
    );

    if (!regRes.ok) {
      throw new Error(`Registration failed: ${await regRes.text()}`);
    }

    onProgress?.(100);
    return await regRes.json();
  };

  // Upload mixed recording
  const uploadMixedRecording = async (wavBlob: Blob, actualSampleRate?: number) => {
    if (!room || !wavBlob || wavBlob.size === 0) return;

    setIsMixedUploading(true);
    setMixedUploadProgress(0);
    const filename = `room_${room.session_id}_mixed_${Date.now()}.wav`;

    try {
      await uploadViaPresignedUrl(
        wavBlob, filename,
        currentParticipant?.id || "mixed", "Mixed", "mixed",
        (pct) => setMixedUploadProgress(pct),
        actualSampleRate,
      );
      toast.success("Áudio mixado enviado!");
    } catch (error) {
      console.error("Mixed upload error:", error);
      // Don't download the mixed file as fallback — individual tracks are what matters.
      // The mixed track can be reconstructed server-side from individual tracks.
      toast.error("Erro ao enviar áudio combinado (os áudios individuais serão enviados normalmente)");
    } finally {
      setIsMixedUploading(false);
    }
  };

  // Upload a remote participant's backup recording
  const uploadRemoteBackup = async (peerId: string, wavBlob: Blob, participantName: string) => {
    if (!room || !wavBlob || wavBlob.size === 0) return;

    const filename = `room_${room.session_id}_${peerId}_${Date.now()}.wav`;
    try {
      await uploadViaPresignedUrl(
        wavBlob, filename,
        peerId, participantName, "remote_backup",
      );
      console.log(`[RemoteBackup] Uploaded backup for ${participantName}`);
      toast.success(`Backup de ${participantName} enviado!`);
    } catch (error) {
      console.error(`[RemoteBackup] Upload error for ${participantName}:`, error);
      try {
        const url = URL.createObjectURL(wavBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.info(`Backup de ${participantName} salvo localmente`);
      } catch (dlErr) {
        console.error("Local save also failed:", dlErr);
      }
    }
  };

  // Stop recording (creator only)
  const handleStopRecording = async () => {
    if (!room || !roomId) return;

    setUploadOverlayHold(true);
    const uploadPromises: Promise<void>[] = [];
    const newBlobs = new Map<string, { blob: Blob; label: string }>();

    // Stop mixed recording
    let mixedBlob: Blob | null = null;
    let mixedSampleRate: number | undefined;
    if (currentParticipant?.is_creator && mixedRecorder.isRecording) {
      const mixedResult = await mixedRecorder.stopRecording();
      if (mixedResult) {
        mixedBlob = mixedResult.blob;
        mixedSampleRate = mixedResult.sampleRate;
        newBlobs.set("mixed", { blob: mixedResult.blob, label: "Áudio Mixado" });
      }
    }

    // Stop remote backup recorders (all participants)
    let remoteBlobs: Map<string, { blob: Blob; participantName: string }> | null = null;
    if (remoteRecorders.isRecording) {
      remoteBlobs = await remoteRecorders.stopRecording();
      if (remoteBlobs.size > 0) {
        remoteBlobs.forEach(({ blob, participantName }, peerId) => {
          newBlobs.set(`remote_${peerId}`, { blob, label: `Backup - ${participantName}` });
        });
      }
    }

    // Save blobs to state for download links
    setSavedBlobs(newBlobs);

    // Save to IndexedDB for offline recovery
    for (const [key, { blob }] of newBlobs) {
      try {
        const { saveBlob } = await import("@/lib/audioIndexedDB");
        await saveBlob(`${room.session_id}_${key}`, blob);
      } catch (e) {
        console.warn("[IndexedDB] Save failed:", e);
      }
    }

    // Start uploads
    if (mixedBlob) {
      uploadPromises.push(uploadMixedRecording(mixedBlob, mixedSampleRate));
    }
    if (remoteBlobs && remoteBlobs.size > 0) {
      setRemoteUploadsInProgress(remoteBlobs.size);
      setRemoteUploadsDone(0);
      for (const [peerId, { blob, participantName }] of remoteBlobs) {
        const p = uploadRemoteBackup(peerId, blob, participantName).finally(() => {
          setRemoteUploadsDone(prev => {
            const next = prev + 1;
            if (next >= remoteBlobs!.size) {
              setTimeout(() => { setRemoteUploadsInProgress(0); setRemoteUploadsDone(0); }, 2000);
            }
            return next;
          });
        });
        uploadPromises.push(p);
      }
    }

    await supabase
      .from("rooms")
      .update({ is_recording: false, status: "completed" })
      .eq("id", roomId);

    toast.success(t("room.recordingStopped") || "Gravação finalizada! Processando uploads...");

    if (uploadPromises.length > 0) {
      await Promise.allSettled(uploadPromises);
      // Don't auto-dismiss — overlay stays for download links
    }
  };

  // Force retry: re-upload from saved blobs in memory
  const handleForceRetry = async () => {
    if (savedBlobs.size === 0 || isRetrying) return;
    setIsRetrying(true);

    const uploadPromises: Promise<void>[] = [];

    const mixedEntry = savedBlobs.get("mixed");
    if (mixedEntry) {
      uploadPromises.push(uploadMixedRecording(mixedEntry.blob));
    }

    const remoteEntries = Array.from(savedBlobs.entries()).filter(([k]) => k.startsWith("remote_"));
    if (remoteEntries.length > 0) {
      setRemoteUploadsInProgress(remoteEntries.length);
      setRemoteUploadsDone(0);
      for (const [key, { blob, label }] of remoteEntries) {
        const peerId = key.replace("remote_", "");
        const name = label.replace("Backup - ", "");
        const p = uploadRemoteBackup(peerId, blob, name).finally(() => {
          setRemoteUploadsDone(prev => {
            const next = prev + 1;
            if (next >= remoteEntries.length) {
              setTimeout(() => { setRemoteUploadsInProgress(0); setRemoteUploadsDone(0); }, 2000);
            }
            return next;
          });
        });
        uploadPromises.push(p);
      }
    }

    if (uploadPromises.length > 0) {
      await Promise.allSettled(uploadPromises);
    }
    setIsRetrying(false);
  };

  // Download a blob directly from memory
  const downloadBlobFile = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Dismiss overlay and navigate away
  const handleDismissOverlay = () => {
    setUploadOverlayHold(false);
    setSavedBlobs(new Map());
    setOverlayStartedAt(null);
    setOverlayElapsed(0);
  };

  // Copy room link with referral code
  const copyLink = async () => {
    try {
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
    } catch (e) {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      toast.success("Link copiado!");
      setTimeout(() => setCopied(false), 2000);
    }
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

  // Diagnostic: log render state for debugging disappearing top section
  useEffect(() => {
    if (currentParticipant && room) {
      console.log("[Room:Render] state snapshot:", {
        roomStatus: room.status,
        isRecording: room.is_recording,
        durationMinutes: room.duration_minutes,
        topic: room.topic,
        participantCount: participants.length,
        currentParticipantId: currentParticipant.id,
        audioTestStatus: currentParticipant.audio_test_status,
        showTimer: !!room.duration_minutes,
        showAudioTest: !room.is_recording && room.status !== "completed",
      });
    }
  }, [room?.status, room?.is_recording, room?.duration_minutes, currentParticipant?.id, participants.length]);

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

    const isAnyUploadInProgress = isMixedUploading || remoteUploadsInProgress > 0 || uploadOverlayHold;
    const uploadsActive = isMixedUploading || remoteUploadsInProgress > 0 || isRetrying;

    // Full-screen upload overlay with force retry + download links
    const uploadOverlay = isAnyUploadInProgress && (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-6 p-8 max-w-md text-center w-full">
          <div className="relative">
            {uploadsActive ? (
              <div className="absolute inset-0 animate-ping rounded-full bg-red-500/30" />
            ) : null}
            <div className="relative flex items-center justify-center w-20 h-20 rounded-full bg-red-500/20 border-2 border-red-500">
              {uploadsActive ? (
                <Loader2 className="h-10 w-10 text-red-400 animate-spin" />
              ) : (
                <Check className="h-10 w-10 text-green-400" />
              )}
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-black uppercase tracking-tight text-white">
              {uploadsActive ? (t("room.uploadOverlayTitle") || "Enviando áudios...") : "Upload concluído"}
            </h2>
            <p className="text-sm text-red-300 font-medium">
              {uploadsActive
                ? (t("room.uploadOverlayDesc") || "Não feche esta aba!")
                : "Você pode baixar os arquivos abaixo como backup."}
            </p>
          </div>

          {/* Upload progress */}
          <div className="w-full space-y-3">
            {isMixedUploading && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-white/70">
                  <span>{t("room.uploadMixedAudio") || "Áudio mixado"}</span>
                  <span>{mixedUploadProgress}%</span>
                </div>
                <Progress value={mixedUploadProgress} className="h-2" />
              </div>
            )}
            {remoteUploadsInProgress > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-white/70">
                  <span>{t("room.uploadRemoteBackups") || "Backups remotos"}</span>
                  <span>{remoteUploadsDone}/{remoteUploadsInProgress}</span>
                </div>
                <Progress value={(remoteUploadsDone / remoteUploadsInProgress) * 100} className="h-2" />
              </div>
            )}
          </div>

          {/* Force retry button: visible at 30s, clickable at 2min */}
          {overlayElapsed >= 30 && uploadsActive && (
            <button
              onClick={handleForceRetry}
              disabled={overlayElapsed < 120 || isRetrying}
              className="flex items-center gap-2 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-white border transition-all"
              style={{
                borderColor: overlayElapsed < 120 ? "hsl(0 0% 40%)" : "hsl(45 93% 47%)",
                background: overlayElapsed < 120 ? "transparent" : "hsl(45 93% 47% / 0.15)",
                color: overlayElapsed < 120 ? "hsl(0 0% 60%)" : "hsl(45 93% 47%)",
                cursor: overlayElapsed < 120 ? "not-allowed" : "pointer",
              }}
            >
              <RotateCw className={`h-4 w-4 ${isRetrying ? "animate-spin" : ""}`} />
              {overlayElapsed < 120
                ? `Forçar reenvio (${formatDuration(120 - overlayElapsed)})`
                : isRetrying
                  ? "Reenviando..."
                  : "Forçar reenvio"}
            </button>
          )}

          {/* Download links for saved blobs */}
          {savedBlobs.size > 0 && (
            <div className="w-full space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-widest text-white/50">
                Backup local dos arquivos
              </p>
              {Array.from(savedBlobs.entries()).map(([key, { blob, label }]) => (
                <button
                  key={key}
                  onClick={() => downloadBlobFile(blob, `${room?.session_id || "session"}_${key}.wav`)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left font-mono text-xs text-white/80 hover:text-white transition-colors"
                  style={{ border: "1px solid hsl(0 0% 30%)", background: "hsl(0 0% 10%)" }}
                >
                  <Download className="h-4 w-4 shrink-0 text-green-400" />
                  <span className="flex-1">{label}</span>
                  <span className="text-white/40">{(blob.size / 1024 / 1024).toFixed(1)} MB</span>
                </button>
              ))}
            </div>
          )}

          {/* Dismiss button (only when not actively uploading) */}
          {!uploadsActive && (
            <button
              onClick={handleDismissOverlay}
              className="px-6 py-2.5 font-mono text-sm font-bold uppercase tracking-wider text-black"
              style={{ background: "hsl(45 93% 47%)" }}
            >
              Concluir
            </button>
          )}
        </div>
      </div>
    );

    // Check if user might be the creator via localStorage
    const storedParticipantId = roomId ? localStorage.getItem(`room_${roomId}_participant`) : null;
    // Check participants list first, but also check DB-fetched creator (may be disconnected)
    const creatorParticipant = participants.find(p => p.is_creator) || dbCreatorParticipant;
    // user_id check is handled in useEffect, but we can also use localStorage as primary UI hint
    const isLikelyCreator = !!(storedParticipantId && creatorParticipant && storedParticipantId === creatorParticipant.id);

    // Awaiting host approval screen (public rooms)
    if (awaitingApproval) {
      return (
        <div className="max-w-md mx-auto space-y-6">
          <div className="text-center space-y-4">
            <div className="inline-flex items-center justify-center w-16 h-16 mb-2 animate-pulse" style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}>
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
            <h2 className="font-mono text-xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
              Aguardando Aprovação
            </h2>
            <p className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
              Sua solicitação foi enviada ao host. Você será conectado automaticamente quando aprovado.
            </p>
          </div>
        </div>
      );
    }

    // Rejected join request screen
    if (joinRequestRejected) {
      return (
        <div className="max-w-md mx-auto space-y-6">
          <div className="text-center space-y-4">
            <div className="inline-flex items-center justify-center w-16 h-16 mb-2" style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}>
              <XCircle className="h-8 w-8" />
            </div>
            <h2 className="font-mono text-xl font-black uppercase tracking-tight" style={{ color: "var(--portal-text)" }}>
              Solicitação Recusada
            </h2>
            <p className="font-mono text-xs" style={{ color: "var(--portal-text-muted)" }}>
              O host recusou sua entrada nesta sala.
            </p>
            <KGenButton
              variant="outline"
              className="mx-auto"
              onClick={() => navigate("/rooms")}
              scrambleText="VOLTAR ÀS SALAS"
            />
          </div>
        </div>
      );
    }

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
                scrambleText={isJoining ? "CONECTANDO..." : room?.is_public ? "SOLICITAR ENTRADA" : "ENTRAR COMO PARTICIPANTE"}
              />

              {!room?.is_public && (
                <>
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
                </>
              )}

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

  // Diagnostic log moved above early returns (see below)

  // Room view
  if (isPortal) {
    // Portal-themed room view
    return (
      <>
      {uploadOverlay}
      <div className="space-y-6">
        <RecordingGuidelinesSidebar />
        {/* Portal Room Header */}
        <div className="flex flex-col gap-4 sm:gap-6 pb-6 sm:pb-12 mb-6 sm:mb-12" style={{ borderBottom: "1px solid var(--portal-border)" }}>
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-3 h-3" style={{ background: room.is_recording ? "hsl(0 84% 60%)" : "var(--portal-accent)" }} />
              <span className="font-mono text-xs tracking-[0.3em] uppercase" style={{ color: room.is_recording ? "hsl(0 84% 60%)" : "var(--portal-accent)" }}>
                {room.is_recording ? `${t("room.recording")} ${formatDuration(recordingDuration)}` : room.status === "completed" ? t("room.completed") : t("room.waiting")}
              </span>
            </div>
            <h1 className="font-mono text-2xl sm:text-4xl font-black uppercase tracking-tight mb-4" style={{ color: "var(--portal-text)" }}>
              {room.room_name || `Sala de ${room.creator_name}`}
            </h1>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-8">
              <p className="font-mono text-base flex items-center gap-2" style={{ color: "var(--portal-text-muted)" }}>
                <Users className="h-5 w-5" /> {participants.length} {t("room.participants")}
              </p>
              {room.topic && (
                <p className="font-mono text-base flex items-center gap-2" style={{ color: "var(--portal-accent)" }}>
                  <MessageSquare className="h-5 w-5" /> {room.topic}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 justify-start sm:justify-end flex-wrap">
            <KGenButton
              variant="primary"
              size="sm"
              onClick={copyLink}
              scrambleText={copied ? t("room.copied") : t("room.inviteOther")}
              icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            />
            {isCreator && !room.is_public && (
              <KGenButton
                size="sm"
                onClick={async () => {
                  const { error } = await supabase.from("rooms").update({ is_public: true }).eq("id", room.id);
                  if (error) { toast.error("Erro ao abrir sala"); return; }
                  setRoom(prev => prev ? { ...prev, is_public: true } : prev);
                  toast.success("Sala agora é pública!");
                }}
                scrambleText="ABRIR SALA PÚBLICA"
                icon={<Globe className="h-4 w-4" />}
              />
            )}
            {isCreator && room.is_public && (
              <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest px-3 py-1.5" style={{ border: "1px solid var(--portal-accent)", color: "var(--portal-accent)" }}>
                <Globe className="h-3.5 w-3.5" /> Sala Pública
              </span>
            )}
            <KGenButton
              size="sm"
              onClick={handleLeave}
              scrambleText={t("room.leave")}
              className="!bg-[hsl(0,84%,45%)] !text-white hover:!brightness-[1.1]"
            />
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-4 sm:gap-6" style={{ maxWidth: "1200px", margin: "0 auto" }}>
          {/* LEFT COLUMN - Controls */}
          <div className="space-y-4 w-full lg:w-[33%] order-1">
            {/* Audio Test Flow */}
            {!room.is_recording && room.status !== "completed" && (
              <AudioTestFlow
                participantId={currentParticipant.id}
                participantName={currentParticipant.name}
                roomId={room.id}
                stream={mediaStreamRef.current}
                testStatus={currentParticipant.audio_test_status || "pending"}
                testResults={currentParticipant.audio_test_results}
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
                {/* Idle timeout — Daily disconnected */}
                {idleTimedOut && !room.is_recording && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 px-3 py-2" style={{ background: "hsl(0 80% 50% / 0.1)", border: "1px solid hsl(0 80% 50% / 0.3)" }}>
                      <Timer className="h-4 w-4 shrink-0" style={{ color: "hsl(0 80% 50%)" }} />
                      <p className="font-mono text-xs" style={{ color: "hsl(0 80% 50%)" }}>
                        Conexão de áudio encerrada por inatividade (5 min sem gravar).
                      </p>
                    </div>
                    <KGenButton
                      onClick={handleReopenDaily}
                      scrambleText="REABRIR SALA"
                      icon={<Radio className="h-5 w-5" />}
                      className="w-full"
                    />
                  </div>
                )}

                {!idleTimedOut && (
                  <>
                    {!canStartRecording && !room.is_recording && (
                      <div className="flex items-center gap-2 px-3 py-2" style={{ background: "hsl(40 80% 50% / 0.1)", border: "1px solid hsl(40 80% 50% / 0.3)" }}>
                        <AlertCircle className="h-4 w-4 shrink-0" style={{ color: "hsl(40 80% 50%)" }} />
                        <p className="font-mono text-xs" style={{ color: "hsl(40 80% 50%)" }}>
                          {t("room.minParticipantsWarning", { count: minParticipants || 2, current: connectedCount })}
                        </p>
                      </div>
                    )}
                    <div className="flex items-center justify-center">
                      {!room.is_recording ? (
                        <KGenButton
                          onClick={handleStartRecording}
                          disabled={room.status === "completed" || !canStartRecording}
                          scrambleText={
                            idleSecondsLeft != null && idleSecondsLeft > 0
                              ? `${t("room.startRecording")} (${Math.floor(idleSecondsLeft / 60)}:${String(idleSecondsLeft % 60).padStart(2, "0")})`
                              : t("room.startRecording")
                          }
                          icon={<Circle className="h-5 w-5 fill-red-500 text-red-500" />}
                          className="w-full"
                        />
                      ) : (
                        <KGenButton
                          variant="dark"
                          onClick={handleStopRecording}
                          scrambleText={t("room.stopRecording")}
                          icon={<Square className="h-4 w-4 fill-current" />}
                          className="w-full"
                        />
                      )}
                    </div>
                    {/* Idle countdown bar */}
                    {idleSecondsLeft != null && idleSecondsLeft > 0 && !room.is_recording && (
                      <div className="space-y-1">
                        <div className="flex justify-between font-mono text-[10px]" style={{ color: idleSecondsLeft < 60 ? "hsl(0 80% 50%)" : "var(--portal-text-muted)" }}>
                          <span>TEMPO PARA INICIAR GRAVAÇÃO</span>
                          <span>{Math.floor(idleSecondsLeft / 60)}:{String(idleSecondsLeft % 60).padStart(2, "0")}</span>
                        </div>
                        <Progress value={(idleSecondsLeft / IDLE_TIMEOUT_SECONDS) * 100} className="h-1" />
                      </div>
                    )}
                  </>
                )}

                {isMixedUploading && (
                  <div className="space-y-1">
                    <div className="flex justify-between font-mono text-[10px]" style={{ color: "var(--portal-text-muted)" }}>
                      <span>ENVIANDO ÁUDIO...</span>
                      <span>{mixedUploadProgress}%</span>
                    </div>
                    <Progress value={mixedUploadProgress} className="h-1" />
                  </div>
                )}
                {remoteUploadsInProgress > 0 && (
                  <div className="space-y-1">
                    <div className="flex justify-between font-mono text-[10px]" style={{ color: "var(--portal-text-muted)" }}>
                      <span>BACKUPS REMOTOS</span>
                      <span>{remoteUploadsDone}/{remoteUploadsInProgress}</span>
                    </div>
                    <Progress value={(remoteUploadsDone / remoteUploadsInProgress) * 100} className="h-1" />
                  </div>
                )}
                <div className="flex items-center justify-center gap-3 pt-2 font-mono text-[10px]" style={{ borderTop: "1px solid var(--portal-border)" }}>
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
                  {t("room.participantsTitle")} ({participants.length})
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
                      <div className={`w-2.5 h-2.5 rounded-full ${p.is_connected ? "bg-green-500" : "bg-red-500"}`} title={p.is_connected ? "Online" : "Offline"} />
                      <span className="font-mono text-xs font-bold" style={{ color: "var(--portal-text)" }}>{p.name}</span>
                      {p.is_creator && (
                        <span className="font-mono text-[9px] px-1.5 py-0.5 uppercase" style={{ border: "1px solid var(--portal-border)", color: "var(--portal-text-muted)" }}>
                          {t("room.creator")}
                        </span>
                      )}
                      {p.id === currentParticipant.id && (
                        <span className="font-mono text-[9px] px-1.5 py-0.5 uppercase" style={{ background: "var(--portal-accent)", color: "var(--portal-accent-text)" }}>
                          {t("room.you")}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <AudioLevelIndicator
                        stream={p.id === currentParticipant.id ? localStream : (remoteStreams.get(p.id) ?? null)}
                        isConnected={!!p.is_connected}
                        status={p.id === currentParticipant.id ? "connected" : peerStatuses.get(p.id)}
                        compact
                      />
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
              <div className="p-3 flex items-center justify-between gap-2" style={{ borderBottom: "1px solid var(--portal-border)" }}>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--portal-text)" }}>{t("room.yourAudio")}</span>
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider"
                    style={{
                      background: "hsl(45 93% 47% / 0.15)",
                      color: "hsl(45 93% 47%)",
                      border: "1px solid hsl(45 93% 47% / 0.3)",
                    }}
                  >
                    <Lightbulb className="h-3 w-3" />
                    {t("room.chooseBestMic")}
                  </span>
                </div>
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
                  campaignId={campaignId}
                />
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN - Content */}
          <div className="space-y-4 w-full lg:w-[67%] order-first lg:order-2">
            {/* Topic + Timer — two-column layout, timer takes 2/3 */}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-4">
              {/* Topic (left, smaller) */}
              {room.topic && (
                <div className="p-4 flex flex-col items-center justify-center text-center" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
                  <span className="font-mono text-[10px] uppercase tracking-widest block mb-2" style={{ color: "var(--portal-text-muted)" }}>
                    {t("room.conversationTopicLabel")}
                  </span>
                  <p className="font-mono text-lg font-bold uppercase" style={{ color: "var(--portal-text)" }}>
                    {room.topic}
                  </p>
                </div>
              )}

              {/* Timer (right, larger) */}
              {(() => {
                if (room.is_recording && room.recording_started_at) {
                  if (room.duration_minutes) {
                    const totalSeconds = room.duration_minutes * 60;
                    const remaining = Math.max(0, totalSeconds - recordingDuration);
                    const mins = Math.floor(remaining / 60);
                    const secs = remaining % 60;
                    const pct = ((totalSeconds - remaining) / totalSeconds) * 100;
                    const isLow = remaining <= 60;
                    return (
                      <div className="p-4 text-center space-y-2" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
                        <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
                          {t("room.timeRemaining")}
                        </span>
                        <p className="font-mono text-3xl sm:text-5xl font-black tabular-nums leading-none" style={{ color: isLow ? "hsl(0 84% 60%)" : "var(--portal-accent)" }}>
                          {mins.toString().padStart(2, "0")}:{secs.toString().padStart(2, "0")}
                        </p>
                        <div className="w-full h-1.5" style={{ background: "var(--portal-border)" }}>
                          <div className="h-full transition-all duration-1000" style={{ width: `${pct}%`, background: isLow ? "hsl(0 84% 60%)" : "var(--portal-accent)" }} />
                        </div>
                      </div>
                    );
                  }
                  const elapsedMins = Math.floor(recordingDuration / 60);
                  const elapsedSecs = recordingDuration % 60;
                  return (
                    <div className="p-4 text-center space-y-2" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
                      <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
                        {t("room.recordingTime", { defaultValue: "Tempo de Gravação" })}
                      </span>
                      <p className="font-mono text-3xl sm:text-5xl font-black tabular-nums leading-none" style={{ color: "hsl(0 84% 60%)" }}>
                        {elapsedMins.toString().padStart(2, "0")}:{elapsedSecs.toString().padStart(2, "0")}
                      </p>
                    </div>
                  );
                }
                if (!room.is_recording && room.status !== "completed") {
                  if (room.duration_minutes) {
                    return (
                      <div className="p-4 text-center space-y-2" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
                        <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
                          {t("room.conversationTime")}
                        </span>
                        <p className="font-mono text-3xl sm:text-5xl font-black tabular-nums leading-none" style={{ color: "var(--portal-accent)" }}>
                          {room.duration_minutes.toString().padStart(2, "0")}:00
                        </p>
                      </div>
                    );
                  }
                  return (
                    <div className="p-4 text-center space-y-2" style={{ border: "1px solid var(--portal-border)", background: "var(--portal-card-bg)" }}>
                      <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--portal-text-muted)" }}>
                        {t("room.status", { defaultValue: "Status" })}
                      </span>
                      <p className="font-mono text-xl sm:text-3xl font-black uppercase leading-none" style={{ color: "var(--portal-accent)" }}>
                        {t("room.readyToRecord", { defaultValue: "Pronta para Gravar" })}
                      </p>
                    </div>
                  );
                }
                return null;
              })()}
            </div>

            {/* Script / Talking Points — AI generated */}
            <TalkingPointsBlock topic={room.topic} />
          </div>
        </div>
      </div>
      </>
    );
  }

  // Original non-portal room view
  return (
    <>
    {uploadOverlay}
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
                          {!canStartRecording && (
                            <p className="text-xs text-amber-500 text-center">
                              {t("room.minParticipantsWarning", { count: minParticipants || 2, current: connectedCount })}
                            </p>
                          )}
                          <Button 
                            size="lg" 
                            onClick={handleStartRecording}
                            className="bg-red-600 hover:bg-red-700"
                            disabled={room.status === "completed" || !canStartRecording}
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
                    {remoteUploadsInProgress > 0 && (
                      <div className="space-y-1 px-2">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Backups remotos...</span>
                          <span>{remoteUploadsDone}/{remoteUploadsInProgress}</span>
                        </div>
                        <Progress value={(remoteUploadsDone / remoteUploadsInProgress) * 100} className="h-1" />
                      </div>
                    )}
                    <div className="flex items-center justify-center gap-6 pt-2 border-t border-border/50">
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
                    <div className={`w-2.5 h-2.5 rounded-full ${p.is_connected ? "bg-green-500" : "bg-red-500"}`} title={p.is_connected ? "Online" : "Offline"} />
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
                    <AudioLevelIndicator
                      stream={p.id === currentParticipant.id ? localStream : (remoteStreams.get(p.id) ?? null)}
                      isConnected={!!p.is_connected}
                      status={p.id === currentParticipant.id ? "connected" : peerStatuses.get(p.id)}
                    />
                    <Mic className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Join Requests (host only, public rooms) */}
        {isCreator && room?.is_public && joinRequests.length > 0 && (
          <Card className="border-amber-500/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <LogIn className="h-4 w-4 text-amber-400" />
                Solicitações de Entrada ({joinRequests.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {joinRequests.map((req) => (
                  <div
                    key={req.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                  >
                    <div>
                      <p className="font-medium text-sm">{req.user_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(req.created_at).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10"
                        onClick={() => handleApproveJoin(req)}
                      >
                        <Check className="h-3.5 w-3.5 mr-1" />
                        Aprovar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
                        onClick={() => handleRejectJoin(req)}
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1" />
                        Recusar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
    </>
  );
};

export default Room;
