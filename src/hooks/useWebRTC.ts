import { useEffect, useRef, useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
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
};

interface PeerState {
  connection: RTCPeerConnection;
  remoteStream: MediaStream;
  pendingCandidates: RTCIceCandidateInit[];
}

interface UseWebRTCOptions {
  roomId: string | undefined;
  participantId: string | undefined;
  localStream: MediaStream | null;
  participants: { id: string; name: string }[];
}

export function useWebRTC({ roomId, participantId, localStream, participants }: UseWebRTCOptions) {
  const peersRef = useRef<Map<string, PeerState>>(new Map());
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const participantIdRef = useRef<string | undefined>();

  // Keep refs in sync
  useEffect(() => {
    localStreamRef.current = localStream;
    participantIdRef.current = participantId;
  }, [localStream, participantId]);

  const updateRemoteStreams = useCallback(() => {
    const map = new Map<string, MediaStream>();
    peersRef.current.forEach((peer, id) => {
      if (peer.remoteStream.getTracks().length > 0) {
        map.set(id, peer.remoteStream);
      }
    });
    setRemoteStreams(new Map(map));
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

  const createPeerConnection = useCallback((remoteParticipantId: string): PeerState => {
    // Close existing connection if any
    const existing = peersRef.current.get(remoteParticipantId);
    if (existing) {
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
      console.log(`[WebRTC] ICE state for ${remoteParticipantId}: ${connection.iceConnectionState}`);
    };

    connection.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection to ${remoteParticipantId}: ${connection.connectionState}`);
      if (connection.connectionState === "failed") {
        console.log(`[WebRTC] Connection failed to ${remoteParticipantId}, will retry on next participant update`);
        peersRef.current.delete(remoteParticipantId);
        updateRemoteStreams();
      }
    };

    const state: PeerState = { connection, remoteStream, pendingCandidates: [] };
    peersRef.current.set(remoteParticipantId, state);
    return state;
  }, [roomId, updateRemoteStreams]);

  // Initiate connection to a remote participant (caller side)
  const connectToPeer = useCallback(async (remoteParticipantId: string) => {
    if (!participantIdRef.current || !roomId || !localStreamRef.current) return;
    if (peersRef.current.has(remoteParticipantId)) return;

    console.log(`[WebRTC] Creating offer for ${remoteParticipantId}`);
    const peer = createPeerConnection(remoteParticipantId);

    const offer = await peer.connection.createOffer();
    await peer.connection.setLocalDescription(offer);

    await supabase.from("webrtc_signals").insert([{
      room_id: roomId,
      sender_id: participantIdRef.current,
      receiver_id: remoteParticipantId,
      signal_type: "offer",
      signal_data: { sdp: offer.sdp, type: offer.type } as any,
    }]);
  }, [roomId, createPeerConnection]);

  // Handle incoming signals via realtime subscription
  useEffect(() => {
    if (!roomId || !participantId || !localStream) return;

    const handleSignal = async (signal: any) => {
      const senderId = signal.sender_id;
      if (senderId === participantId) return;

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
  }, [roomId, participantId, localStream, createPeerConnection, updateRemoteStreams, flushCandidates]);

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
  }, [participants, participantId, localStream, connectToPeer]);

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
        peer.connection.close();
      });
      peersRef.current.clear();
    };
  }, []);

  return { remoteStreams };
}
