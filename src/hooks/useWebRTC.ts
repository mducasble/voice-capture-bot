import { useEffect, useRef, useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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

// Reconnection config
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 1000; // 1s

// Cache TURN credentials (valid for ~24h, refresh every 12h)
let cachedIceConfig: RTCConfiguration | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours

async function getIceConfig(): Promise<RTCConfiguration> {
  if (cachedIceConfig && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedIceConfig;
  }

  try {
    const { data, error } = await supabase.functions.invoke("get-turn-credentials");
    if (error) throw error;

    if (data?.iceServers && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
      // Add Google STUN servers as fallback
      const iceServers = [
        { urls: "stun:stun.l.google.com:19302" },
        ...data.iceServers,
      ];
      cachedIceConfig = { iceServers, iceCandidatePoolSize: 5 };
      cacheTimestamp = Date.now();
      console.log("[WebRTC] Loaded dynamic TURN credentials from Metered");
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

  // Pre-fetch dynamic TURN credentials
  useEffect(() => {
    getIceConfig().then(config => {
      iceConfigRef.current = config;
    });
  }, []);

  // Keep refs in sync
  useEffect(() => {
    localStreamRef.current = localStream;
    participantIdRef.current = participantId;
  }, [localStream, participantId]);

  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

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

  /** Flush queued ICE candidates once remoteDescription is set */
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

  // Reconnect a failed peer with exponential backoff
  const reconnectPeer = useCallback((remoteParticipantId: string) => {
    const peer = peersRef.current.get(remoteParticipantId);
    const attempts = peer?.reconnectAttempts ?? 0;

    if (attempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn(`[WebRTC] Max reconnect attempts reached for ${remoteParticipantId}`);
      updatePeerStatus(remoteParticipantId, "failed");
      return;
    }

    // Check if remote participant is still in the room
    const stillPresent = participantsRef.current.some(p => p.id === remoteParticipantId);
    if (!stillPresent) {
      console.log(`[WebRTC] Participant ${remoteParticipantId} left, skipping reconnect`);
      return;
    }

    const delay = BASE_RECONNECT_DELAY * Math.pow(2, attempts);
    console.log(`[WebRTC] Scheduling reconnect #${attempts + 1} for ${remoteParticipantId} in ${delay}ms`);
    updatePeerStatus(remoteParticipantId, "reconnecting");

    const timer = setTimeout(async () => {
      if (!participantIdRef.current || !roomId || !localStreamRef.current) return;

      // Clean up old connection
      const existingPeer = peersRef.current.get(remoteParticipantId);
      if (existingPeer) {
        if (existingPeer.reconnectTimer) clearTimeout(existingPeer.reconnectTimer);
        existingPeer.connection.close();
        peersRef.current.delete(remoteParticipantId);
      }

      // Only the participant with the "smaller" ID initiates
      if (participantIdRef.current < remoteParticipantId) {
        console.log(`[WebRTC] Reconnecting to ${remoteParticipantId} (attempt ${attempts + 1})`);
        const newPeer = createPeerConnectionInternal(remoteParticipantId);
        newPeer.reconnectAttempts = attempts + 1;
        
        try {
          const offer = await newPeer.connection.createOffer();
          await newPeer.connection.setLocalDescription(offer);

          await supabase.from("webrtc_signals").insert([{
            room_id: roomId,
            sender_id: participantIdRef.current,
            receiver_id: remoteParticipantId,
            signal_type: "offer",
            signal_data: { sdp: offer.sdp, type: offer.type } as any,
          }]);
        } catch (e) {
          console.error(`[WebRTC] Reconnect offer failed for ${remoteParticipantId}:`, e);
          // Schedule another attempt
          const nextPeer = peersRef.current.get(remoteParticipantId);
          if (nextPeer) {
            nextPeer.reconnectAttempts = attempts + 1;
            reconnectPeer(remoteParticipantId);
          }
        }
      }
    }, delay);

    // Store timer so it can be cleaned up
    if (peer) {
      peer.reconnectTimer = timer;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, updatePeerStatus]);

  const createPeerConnectionInternal = useCallback((remoteParticipantId: string): PeerState => {
    // Close existing connection if any
    const existing = peersRef.current.get(remoteParticipantId);
    if (existing) {
      if (existing.reconnectTimer) clearTimeout(existing.reconnectTimer);
      existing.connection.close();
      peersRef.current.delete(remoteParticipantId);
    }

    const connection = new RTCPeerConnection(ICE_SERVERS);
    const remoteStream = new MediaStream();

    // Add local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        connection.addTrack(track, localStreamRef.current!);
      });
      console.log(`[WebRTC] Added ${localStreamRef.current.getTracks().length} local tracks for ${remoteParticipantId}`);
    } else {
      console.warn(`[WebRTC] No local stream when connecting to ${remoteParticipantId}`);
    }

    // Handle remote tracks
    connection.ontrack = (event) => {
      console.log(`[WebRTC] Got remote track from ${remoteParticipantId}: ${event.track.kind}`);
      remoteStream.addTrack(event.track);
      updateRemoteStreams();
    };

    // Handle ICE candidates
    connection.onicecandidate = async (event) => {
      if (event.candidate && participantIdRef.current && roomId) {
        await supabase.from("webrtc_signals").insert([{
          room_id: roomId,
          sender_id: participantIdRef.current,
          receiver_id: remoteParticipantId,
          signal_type: "ice",
          signal_data: event.candidate.toJSON() as any,
        }]);
      }
    };

    connection.oniceconnectionstatechange = () => {
      const state = connection.iceConnectionState;
      console.log(`[WebRTC] ICE state for ${remoteParticipantId}: ${state}`);
      
      if (state === "connected" || state === "completed") {
        updatePeerStatus(remoteParticipantId, "connected");
        // Reset reconnect counter on successful connection
        const peer = peersRef.current.get(remoteParticipantId);
        if (peer) peer.reconnectAttempts = 0;
      } else if (state === "disconnected") {
        updatePeerStatus(remoteParticipantId, "reconnecting");
        // ICE disconnected can auto-recover, wait a bit before force-reconnecting
        const peer = peersRef.current.get(remoteParticipantId);
        if (peer && !peer.reconnectTimer) {
          peer.reconnectTimer = setTimeout(() => {
            peer.reconnectTimer = null;
            // If still disconnected after 5s, force reconnect
            if (connection.iceConnectionState === "disconnected" || connection.iceConnectionState === "failed") {
              reconnectPeer(remoteParticipantId);
            }
          }, 5000);
        }
      }
    };

    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      console.log(`[WebRTC] Connection to ${remoteParticipantId}: ${state}`);
      
      if (state === "failed") {
        console.log(`[WebRTC] Connection failed to ${remoteParticipantId}, scheduling reconnect`);
        reconnectPeer(remoteParticipantId);
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
  }, [roomId, updateRemoteStreams, updatePeerStatus, reconnectPeer]);

  // Initiate connection to a remote participant (caller side)
  const connectToPeer = useCallback(async (remoteParticipantId: string) => {
    if (!participantIdRef.current || !roomId || !localStreamRef.current) return;
    if (peersRef.current.has(remoteParticipantId)) return;

    console.log(`[WebRTC] Creating offer for ${remoteParticipantId}`);
    const peer = createPeerConnectionInternal(remoteParticipantId);

    const offer = await peer.connection.createOffer();
    await peer.connection.setLocalDescription(offer);

    await supabase.from("webrtc_signals").insert([{
      room_id: roomId,
      sender_id: participantIdRef.current,
      receiver_id: remoteParticipantId,
      signal_type: "offer",
      signal_data: { sdp: offer.sdp, type: offer.type } as any,
    }]);
  }, [roomId, createPeerConnectionInternal]);

  // Handle incoming signals via realtime subscription
  useEffect(() => {
    if (!roomId || !participantId || !localStream) return;

    const handleSignal = async (signal: any) => {
      const senderId = signal.sender_id;
      if (senderId === participantId) return;

      if (signal.signal_type === "offer") {
        console.log(`[WebRTC] Received offer from ${senderId}`);
        const peer = createPeerConnectionInternal(senderId);
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
            // Queue candidate — will be flushed when remoteDescription is set
            peer.pendingCandidates.push(signal.signal_data);
          }
        }
      }
    };

    // Process any pending signals first
    const processPendingSignals = async () => {
      const { data: signals } = await supabase
        .from("webrtc_signals")
        .select("*")
        .eq("room_id", roomId)
        .eq("receiver_id", participantId)
        .order("created_at", { ascending: true });

      if (signals && signals.length > 0) {
        for (const signal of signals) {
          await handleSignal(signal);
        }
        await supabase
          .from("webrtc_signals")
          .delete()
          .eq("receiver_id", participantId)
          .eq("room_id", roomId);
      }
    };

    processPendingSignals();

    // Subscribe to new signals
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
          supabase.from("webrtc_signals").delete().eq("id", (payload.new as any).id).then(() => {});
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, participantId, localStream, createPeerConnectionInternal, updateRemoteStreams, flushCandidates]);

  // Connect to new participants when they appear
  useEffect(() => {
    if (!participantId || !localStream) return;

    const otherParticipants = participants.filter(p => p.id !== participantId);

    for (const p of otherParticipants) {
      if (!peersRef.current.has(p.id)) {
        // Only the participant with the "smaller" ID initiates to avoid double-offers
        if (participantId < p.id) {
          connectToPeer(p.id);
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
        updatePeerStatus(peerId, "failed"); // removes from map
        updateRemoteStreams();
      }
    });
  }, [participants, participantId, localStream, connectToPeer, updatePeerStatus, updateRemoteStreams]);

  // Update local tracks when stream changes (e.g. device switch)
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
          peer.connection.addTrack(track, localStream);
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
