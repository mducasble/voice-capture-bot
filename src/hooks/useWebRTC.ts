import { useEffect, useRef, useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

interface PeerState {
  connection: RTCPeerConnection;
  remoteStream: MediaStream;
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
  localStreamRef.current = localStream;
  participantIdRef.current = participantId;

  const updateRemoteStreams = useCallback(() => {
    const map = new Map<string, MediaStream>();
    peersRef.current.forEach((peer, id) => {
      map.set(id, peer.remoteStream);
    });
    setRemoteStreams(new Map(map));
  }, []);

  const createPeerConnection = useCallback((remoteParticipantId: string): PeerState => {
    const connection = new RTCPeerConnection(ICE_SERVERS);
    const remoteStream = new MediaStream();

    // Add local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        connection.addTrack(track, localStreamRef.current!);
      });
    }

    // Handle remote tracks
    connection.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach(track => {
        remoteStream.addTrack(track);
      });
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

    connection.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection to ${remoteParticipantId}: ${connection.connectionState}`);
      if (connection.connectionState === "failed" || connection.connectionState === "disconnected") {
        // Clean up failed connection
        peersRef.current.delete(remoteParticipantId);
        updateRemoteStreams();
      }
    };

    const state: PeerState = { connection, remoteStream };
    peersRef.current.set(remoteParticipantId, state);
    return state;
  }, [roomId, updateRemoteStreams]);

  // Initiate connection to a remote participant (caller side)
  const connectToPeer = useCallback(async (remoteParticipantId: string) => {
    if (!participantIdRef.current || !roomId) return;
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
    if (!roomId || !participantId) return;

    // Process any pending signals first
    const processPendingSignals = async () => {
      const { data: signals } = await supabase
        .from("webrtc_signals")
        .select("*")
        .eq("room_id", roomId)
        .eq("receiver_id", participantId)
        .order("created_at", { ascending: true });

      if (signals) {
        for (const signal of signals) {
          await handleSignal(signal);
        }
        // Clean up processed signals
        if (signals.length > 0) {
          await supabase
            .from("webrtc_signals")
            .delete()
            .eq("receiver_id", participantId)
            .eq("room_id", roomId);
        }
      }
    };

    const handleSignal = async (signal: any) => {
      const senderId = signal.sender_id;
      if (senderId === participantId) return;

      if (signal.signal_type === "offer") {
        console.log(`[WebRTC] Received offer from ${senderId}`);
        // Remove existing peer if any
        const existingPeer = peersRef.current.get(senderId);
        if (existingPeer) {
          existingPeer.connection.close();
          peersRef.current.delete(senderId);
        }

        const peer = createPeerConnection(senderId);
        await peer.connection.setRemoteDescription(new RTCSessionDescription(signal.signal_data));

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
        }
      } else if (signal.signal_type === "ice") {
        const peer = peersRef.current.get(senderId);
        if (peer && peer.connection.remoteDescription) {
          try {
            await peer.connection.addIceCandidate(new RTCIceCandidate(signal.signal_data));
          } catch (e) {
            console.warn("[WebRTC] Failed to add ICE candidate:", e);
          }
        }
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
          // Delete processed signal
          supabase.from("webrtc_signals").delete().eq("id", (payload.new as any).id).then(() => {});
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, participantId, createPeerConnection, updateRemoteStreams]);

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

  // Update local tracks when stream changes
  useEffect(() => {
    if (!localStream) return;

    peersRef.current.forEach((peer) => {
      const senders = peer.connection.getSenders();
      localStream.getTracks().forEach(track => {
        const sender = senders.find(s => s.track?.kind === track.kind);
        if (sender) {
          sender.replaceTrack(track);
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
