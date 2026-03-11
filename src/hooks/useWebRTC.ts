import { useEffect, useRef, useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Helper: insert signal with retry on auth errors
async function insertSignalWithRetry(payload: any, maxRetries = 2): Promise<void> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { error } = await supabase.from("webrtc_signals").insert([payload]);
    if (!error) return;
    const msg = (error as any)?.message || '';
    if ((msg.includes('JWT expired') || (error as any)?.code === 'PGRST303') && attempt < maxRetries) {
      console.warn(`[WebRTC] Signal insert failed (JWT expired), refreshing session (attempt ${attempt + 1})…`);
      await supabase.auth.refreshSession();
      continue;
    }
    console.error(`[WebRTC] Signal insert failed:`, error);
    return;
  }
}

// Fallback ICE config used while fetching dynamic TURN credentials
const FALLBACK_ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
  iceCandidatePoolSize: 5,
};

const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 1000;

let cachedIceConfig: RTCConfiguration | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 12 * 60 * 60 * 1000;

async function getIceConfig(): Promise<RTCConfiguration> {
  if (cachedIceConfig && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedIceConfig;
  }
  try {
    const { data, error } = await supabase.functions.invoke("get-turn-credentials");
    if (error) throw error;
    if (data?.iceServers && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
      const iceServers = [
        { urls: "stun:stun.l.google.com:19302" },
        ...data.iceServers,
      ];
      cachedIceConfig = { iceServers, iceCandidatePoolSize: 5 };
      cacheTimestamp = Date.now();
      console.log("[WebRTC] Loaded dynamic TURN credentials");
      return cachedIceConfig;
    }
  } catch (e) {
    console.warn("[WebRTC] Failed to fetch TURN credentials, using fallback:", e);
  }
  return FALLBACK_ICE_SERVERS;
}

interface PeerState {
  connection: RTCPeerConnection;
  remoteStream: MediaStream;
  pendingCandidates: RTCIceCandidateInit[];
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

export type PeerConnectionStatus = "connecting" | "connected" | "reconnecting" | "failed";

interface UseWebRTCOptions {
  roomId: string | undefined;
  participantId: string | undefined;
  localStream: MediaStream | null;
  participants: { id: string; name: string }[];
}

export function useWebRTC({ roomId, participantId, localStream, participants }: UseWebRTCOptions) {
  const peersRef = useRef<Map<string, PeerState>>(new Map());
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [peerStatuses, setPeerStatuses] = useState<Map<string, PeerConnectionStatus>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const participantIdRef = useRef<string | undefined>();
  const participantsRef = useRef<{ id: string; name: string }[]>([]);
  const iceConfigRef = useRef<RTCConfiguration>(FALLBACK_ICE_SERVERS);
  const roomIdRef = useRef<string | undefined>();

  // Pre-fetch dynamic TURN credentials
  useEffect(() => {
    getIceConfig().then(config => { iceConfigRef.current = config; });
  }, []);

  // Keep refs in sync (no re-renders triggered)
  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);
  useEffect(() => { participantIdRef.current = participantId; }, [participantId]);
  useEffect(() => { participantsRef.current = participants; }, [participants]);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

  const updateRemoteStreams = useCallback(() => {
    const map = new Map<string, MediaStream>();
    peersRef.current.forEach((peer, id) => {
      if (peer.remoteStream.getTracks().length > 0) {
        map.set(id, peer.remoteStream);
      }
    });
    setRemoteStreams(new Map(map));
  }, []);

  const updatePeerStatus = useCallback((peerId: string, status: PeerConnectionStatus) => {
    setPeerStatuses(prev => {
      const next = new Map(prev);
      if (status === "failed") {
        next.delete(peerId);
      } else {
        next.set(peerId, status);
      }
      return next;
    });
  }, []);

  const flushCandidates = useCallback(async (peer: PeerState) => {
    while (peer.pendingCandidates.length > 0) {
      const candidate = peer.pendingCandidates.shift()!;
      try {
        await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn("[WebRTC] Failed to add queued ICE candidate:", e);
      }
    }
  }, []);

  // Create peer connection - works even without localStream (tracks added later)
  const createPeerConnection = useCallback((remoteParticipantId: string): PeerState => {
    const existing = peersRef.current.get(remoteParticipantId);
    if (existing) {
      if (existing.reconnectTimer) clearTimeout(existing.reconnectTimer);
      existing.connection.close();
      peersRef.current.delete(remoteParticipantId);
    }

    const connection = new RTCPeerConnection(iceConfigRef.current);
    const remoteStream = new MediaStream();

    // Add local tracks if available now
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        connection.addTrack(track, localStreamRef.current!);
      });
      console.log(`[WebRTC] Added ${localStreamRef.current.getTracks().length} local tracks for ${remoteParticipantId}`);
    } else {
      console.log(`[WebRTC] No local stream yet for ${remoteParticipantId}, tracks will be added later`);
    }

    connection.ontrack = (event) => {
      console.log(`[WebRTC] Got remote track from ${remoteParticipantId}: ${event.track.kind}`);
      remoteStream.addTrack(event.track);
      updateRemoteStreams();
    };

    connection.onicecandidate = async (event) => {
      if (event.candidate && participantIdRef.current && roomIdRef.current) {
        await insertSignalWithRetry({
          room_id: roomIdRef.current,
          sender_id: participantIdRef.current,
          receiver_id: remoteParticipantId,
          signal_type: "ice",
          signal_data: event.candidate.toJSON() as any,
        });
      }
    };

    connection.oniceconnectionstatechange = () => {
      const state = connection.iceConnectionState;
      console.log(`[WebRTC] ICE state for ${remoteParticipantId}: ${state}`);
      if (state === "connected" || state === "completed") {
        updatePeerStatus(remoteParticipantId, "connected");
        const peer = peersRef.current.get(remoteParticipantId);
        if (peer) peer.reconnectAttempts = 0;
      } else if (state === "disconnected") {
        updatePeerStatus(remoteParticipantId, "reconnecting");
        const peer = peersRef.current.get(remoteParticipantId);
        if (peer && !peer.reconnectTimer) {
          peer.reconnectTimer = setTimeout(() => {
            peer.reconnectTimer = null;
            if (connection.iceConnectionState === "disconnected" || connection.iceConnectionState === "failed") {
              scheduleReconnect(remoteParticipantId);
            }
          }, 5000);
        }
      }
    };

    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      console.log(`[WebRTC] Connection to ${remoteParticipantId}: ${state}`);
      if (state === "failed") {
        scheduleReconnect(remoteParticipantId);
      }
    };

    updatePeerStatus(remoteParticipantId, "connecting");

    const peerState: PeerState = {
      connection,
      remoteStream,
      pendingCandidates: [],
      reconnectAttempts: 0,
      reconnectTimer: null,
    };
    peersRef.current.set(remoteParticipantId, peerState);
    return peerState;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateRemoteStreams, updatePeerStatus]);

  // Reconnection with exponential backoff
  const scheduleReconnect = useCallback((remoteParticipantId: string) => {
    const peer = peersRef.current.get(remoteParticipantId);
    const attempts = peer?.reconnectAttempts ?? 0;

    if (attempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn(`[WebRTC] Max reconnect attempts reached for ${remoteParticipantId}`);
      updatePeerStatus(remoteParticipantId, "failed");
      return;
    }

    const stillPresent = participantsRef.current.some(p => p.id === remoteParticipantId);
    if (!stillPresent) return;

    const delay = BASE_RECONNECT_DELAY * Math.pow(2, attempts);
    console.log(`[WebRTC] Reconnect #${attempts + 1} for ${remoteParticipantId} in ${delay}ms`);
    updatePeerStatus(remoteParticipantId, "reconnecting");

    const timer = setTimeout(async () => {
      const myId = participantIdRef.current;
      const myRoom = roomIdRef.current;
      if (!myId || !myRoom) return;

      const existingPeer = peersRef.current.get(remoteParticipantId);
      if (existingPeer) {
        if (existingPeer.reconnectTimer) clearTimeout(existingPeer.reconnectTimer);
        existingPeer.connection.close();
        peersRef.current.delete(remoteParticipantId);
      }

      if (myId < remoteParticipantId) {
        const newPeer = createPeerConnection(remoteParticipantId);
        newPeer.reconnectAttempts = attempts + 1;
        try {
          const offer = await newPeer.connection.createOffer();
          await newPeer.connection.setLocalDescription(offer);
          await supabase.from("webrtc_signals").insert([{
            room_id: myRoom,
            sender_id: myId,
            receiver_id: remoteParticipantId,
            signal_type: "offer",
            signal_data: { sdp: offer.sdp, type: offer.type } as any,
          }]);
        } catch (e) {
          console.error(`[WebRTC] Reconnect offer failed:`, e);
        }
      }
    }, delay);

    if (peer) peer.reconnectTimer = timer;
  }, [createPeerConnection, updatePeerStatus]);

  // ============================================================
  // SIGNALING: runs as soon as roomId + participantId are known
  // Does NOT depend on localStream
  // ============================================================
  useEffect(() => {
    if (!roomId || !participantId) return;

    let isMounted = true;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const processedIds = new Set<string>();

    const handleSignal = async (signal: any) => {
      const signalId = signal.id;
      if (processedIds.has(signalId)) return;
      processedIds.add(signalId);

      const senderId = signal.sender_id;
      if (senderId === participantId) return;

      try {
        if (signal.signal_type === "offer") {
          console.log(`[WebRTC] Received offer from ${senderId}`);
          const peer = createPeerConnection(senderId);
          await peer.connection.setRemoteDescription(new RTCSessionDescription(signal.signal_data));
          await flushCandidates(peer);

          const answer = await peer.connection.createAnswer();
          await peer.connection.setLocalDescription(answer);

          await supabase.from("webrtc_signals").insert([{
            room_id: roomId,
            sender_id: participantId,
            receiver_id: senderId,
            signal_type: "answer",
            signal_data: { sdp: answer.sdp, type: answer.type } as any,
          }]);
          console.log(`[WebRTC] Sent answer to ${senderId}`);
          updateRemoteStreams();
        } else if (signal.signal_type === "answer") {
          console.log(`[WebRTC] Received answer from ${senderId}`);
          const peer = peersRef.current.get(senderId);
          if (peer && peer.connection.signalingState === "have-local-offer") {
            await peer.connection.setRemoteDescription(new RTCSessionDescription(signal.signal_data));
            await flushCandidates(peer);
          }
        } else if (signal.signal_type === "ice") {
          const peer = peersRef.current.get(senderId);
          if (peer) {
            if (peer.connection.remoteDescription) {
              try {
                await peer.connection.addIceCandidate(new RTCIceCandidate(signal.signal_data));
              } catch (e) {
                console.warn("[WebRTC] Failed to add ICE candidate:", e);
              }
            } else {
              peer.pendingCandidates.push(signal.signal_data);
            }
          }
        }
      } catch (e) {
        console.error(`[WebRTC] Error handling signal ${signal.signal_type} from ${senderId}:`, e);
      }

      // Delete processed signal from DB
      supabase.from("webrtc_signals").delete().eq("id", signalId).then(() => {});
    };

    let authRetrying = false;

    const processPendingSignals = async () => {
      if (!isMounted) return;
      try {
        const { data: signals, error } = await supabase
          .from("webrtc_signals")
          .select("*")
          .eq("room_id", roomId)
          .eq("receiver_id", participantId)
          .order("created_at", { ascending: true });

        if (error) {
          // Detect JWT expired / auth errors and refresh the session
          const msg = typeof error === 'object' && error !== null ? (error as any).message || '' : '';
          if (msg.includes('JWT expired') || msg.includes('JWT') || (error as any).code === 'PGRST303') {
            if (!authRetrying) {
              authRetrying = true;
              console.warn("[WebRTC] JWT expired, refreshing session…");
              const { error: refreshError } = await supabase.auth.refreshSession();
              if (refreshError) {
                console.error("[WebRTC] Session refresh failed:", refreshError);
              } else {
                console.log("[WebRTC] Session refreshed successfully");
              }
              // Allow next attempt after a short cooldown
              setTimeout(() => { authRetrying = false; }, 5000);
            }
            return;
          }
          console.error("[WebRTC] Error fetching signals:", error);
          return;
        }

        if (signals && signals.length > 0) {
          console.log(`[WebRTC] Polling found ${signals.length} pending signals`);
          for (const signal of signals) {
            if (!isMounted) break;
            await handleSignal(signal);
          }
        }
      } catch (e) {
        console.error("[WebRTC] Error in processPendingSignals:", e);
      }
    };

    // Start polling immediately (every 2s)
    const startPolling = () => {
      if (pollTimer) clearTimeout(pollTimer);
      const poll = () => {
        if (!isMounted) return;
        processPendingSignals().then(() => {
          if (isMounted) {
            pollTimer = setTimeout(poll, 2000);
          }
        });
      };
      pollTimer = setTimeout(poll, 500);
    };

    // Initial fetch
    processPendingSignals();

    // Subscribe to realtime as well (belt-and-suspenders)
    const channel = supabase
      .channel(`webrtc-${roomId}-${participantId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "webrtc_signals",
          filter: `receiver_id=eq.${participantId}`,
        },
        (payload) => {
          handleSignal(payload.new);
        }
      )
      .subscribe((status) => {
        console.log(`[WebRTC] Realtime subscription status: ${status}`);
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          startPolling();
        }
      });

    // Also start polling right away in case subscription takes long
    startPolling();

    return () => {
      isMounted = false;
      if (pollTimer) clearTimeout(pollTimer);
      supabase.removeChannel(channel);
    };
  // Only depend on roomId + participantId. Signal handler uses refs for everything else.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, participantId]);

  // Connect to new participants (initiate offers) — needs localStream
  useEffect(() => {
    if (!participantId || !localStream) return;

    const otherParticipants = participants.filter(p => p.id !== participantId);
    for (const p of otherParticipants) {
      if (!peersRef.current.has(p.id)) {
        if (participantId < p.id) {
          // Initiate connection
          (async () => {
            const peer = createPeerConnection(p.id);
            try {
              const offer = await peer.connection.createOffer();
              await peer.connection.setLocalDescription(offer);
              await supabase.from("webrtc_signals").insert([{
                room_id: roomId,
                sender_id: participantId,
                receiver_id: p.id,
                signal_type: "offer",
                signal_data: { sdp: offer.sdp, type: offer.type } as any,
              }]);
              console.log(`[WebRTC] Sent offer to ${p.id}`);
            } catch (e) {
              console.error(`[WebRTC] Failed to create offer for ${p.id}:`, e);
            }
          })();
        }
      }
    }

    // Clean up peers for participants who left
    peersRef.current.forEach((peer, peerId) => {
      const stillPresent = participants.some(p => p.id === peerId);
      if (!stillPresent) {
        console.log(`[WebRTC] Cleaning up peer ${peerId} (participant left)`);
        if (peer.reconnectTimer) clearTimeout(peer.reconnectTimer);
        peer.connection.close();
        peersRef.current.delete(peerId);
        updatePeerStatus(peerId, "failed");
        updateRemoteStreams();
      }
    });
  }, [participants, participantId, localStream, roomId, createPeerConnection, updatePeerStatus, updateRemoteStreams]);

  // Update local tracks when stream changes (e.g. device switch or stream becomes available)
  useEffect(() => {
    if (!localStream) return;

    peersRef.current.forEach((peer, peerId) => {
      const senders = peer.connection.getSenders();
      localStream.getTracks().forEach(track => {
        const sender = senders.find(s => s.track?.kind === track.kind);
        if (sender) {
          sender.replaceTrack(track).catch(e =>
            console.warn(`[WebRTC] Failed to replace track for ${peerId}:`, e)
          );
        } else {
          try {
            peer.connection.addTrack(track, localStream);
          } catch (e) {
            console.warn(`[WebRTC] Failed to add track for ${peerId}:`, e);
          }
        }
      });
    });
  }, [localStream]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      peersRef.current.forEach((peer) => {
        if (peer.reconnectTimer) clearTimeout(peer.reconnectTimer);
        peer.connection.close();
      });
      peersRef.current.clear();
    };
  }, []);

  return { remoteStreams, peerStatuses };
}
