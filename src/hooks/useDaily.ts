import { useEffect, useRef, useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PeerConnectionStatus = "connecting" | "connected" | "reconnecting" | "failed";

interface UseDailyOptions {
  roomId: string | undefined;
  participantId: string | undefined;
  localStream: MediaStream | null;
  participants: { id: string; name: string }[];
  /** When false, the hook will NOT connect to Daily. Defaults to true. */
  enabled?: boolean;
}

/**
 * useDaily — drop-in replacement for useWebRTC using Daily.co SFU.
 * Returns the same interface: { remoteStreams, peerStatuses }
 * Plus: leave() to disconnect, rejoin() to reconnect, isDailyConnected state.
 */
export function useDaily({ roomId, participantId, localStream, participants, enabled = true }: UseDailyOptions) {
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [peerStatuses, setPeerStatuses] = useState<Map<string, PeerConnectionStatus>>(new Map());
  const [isDailyConnected, setIsDailyConnected] = useState(false);
  const callRef = useRef<any>(null);
  const joinedRef = useRef(false);
  const participantIdRef = useRef<string | undefined>();
  // Map Daily session_id → our participant ID
  const dailyToLocalId = useRef<Map<string, string>>(new Map());
  // Keep participants in a ref to avoid recreating callbacks on every poll
  const participantsRef = useRef(participants);
  useEffect(() => { participantsRef.current = participants; }, [participants]);

  useEffect(() => { participantIdRef.current = participantId; }, [participantId]);

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

  // Build remote streams from Daily participants
  const rebuildRemoteStreams = useCallback((call: any) => {
    const dailyParticipants = call.participants();
    const newStreams = new Map<string, MediaStream>();

    for (const [sessionId, dp] of Object.entries(dailyParticipants)) {
      if (sessionId === "local") continue;
      
      const dailyPart = dp as any;
      const dailyName = dailyPart.user_name || "";
      const currentParticipants = participantsRef.current;
      const matchedParticipant = currentParticipants.find(p => p.name === dailyName && p.id !== participantIdRef.current);
      const localId = matchedParticipant?.id || sessionId;
      
      dailyToLocalId.current.set(sessionId, localId);

      const audioTrack = dailyPart.tracks?.audio;
      if (audioTrack?.persistentTrack) {
        const stream = new MediaStream([audioTrack.persistentTrack]);
        newStreams.set(localId, stream);
        updatePeerStatus(localId, "connected");
      } else if (audioTrack?.state === "loading" || audioTrack?.state === "sendable") {
        updatePeerStatus(localId, "connecting");
      }
    }

    setRemoteStreams(newStreams);
  }, [updatePeerStatus]);

  // Core join logic extracted for reuse
  const joinDaily = useCallback(async () => {
    if (!roomId || !participantId || joinedRef.current) return;

    try {
      let DailyIframe: any;
      try {
        const mod = await import("@daily-co/daily-js");
        DailyIframe = mod.default;
      } catch (importErr) {
        console.warn("[Daily] @daily-co/daily-js not available, skipping SFU connection:", importErr);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const myParticipant = participants.find(p => p.id === participantId);
      const participantName = myParticipant?.name || "Participant";

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-daily-token`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${authToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            room_id: roomId,
            participant_name: participantName,
          }),
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        console.warn("[Daily] Failed to get token:", errText);
        return;
      }

      const { token, room_url } = await res.json();

      const call = DailyIframe.createCallObject({
        audioSource: true,
        videoSource: false,
        dailyConfig: {},
      });

      callRef.current = call;

      call.on("participant-joined", (event?: any) => {
        if (!event) return;
        console.log(`[Daily] Participant joined: ${event.participant.user_name}`);
        rebuildRemoteStreams(call);
      });

      call.on("participant-left", (event?: any) => {
        if (!event) return;
        const sessionId = event.participant.session_id;
        const localId = dailyToLocalId.current.get(sessionId) || sessionId;
        console.log(`[Daily] Participant left: ${event.participant.user_name}`);
        
        dailyToLocalId.current.delete(sessionId);
        
        setRemoteStreams(prev => {
          const next = new Map(prev);
          next.delete(localId);
          return next;
        });
        updatePeerStatus(localId, "failed");
      });

      call.on("track-started", (event?: any) => {
        if (!event) return;
        rebuildRemoteStreams(call);
      });

      call.on("track-stopped", (event?: any) => {
        if (!event) return;
        rebuildRemoteStreams(call);
      });

      call.on("error", (event: any) => {
        console.error("[Daily] Error:", event);
      });

      call.on("network-quality-change", (event: any) => {
        if (event && event.threshold === "very-low") {
          console.warn("[Daily] Network quality very low");
        }
      });

      await call.join({
        url: room_url,
        token,
        userName: participantName,
        startVideoOff: true,
        startAudioOff: false,
      });

      joinedRef.current = true;
      setIsDailyConnected(true);
      console.log("[Daily] Joined room successfully");

      if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
          const deviceId = audioTrack.getSettings().deviceId;
          if (deviceId) {
            await call.setInputDevicesAsync({ audioDeviceId: deviceId });
          }
        }
      }

      rebuildRemoteStreams(call);
    } catch (error) {
      console.error("[Daily] Join error:", error);
    }
  }, [roomId, participantId, localStream, rebuildRemoteStreams, updatePeerStatus]);

  // Leave Daily (without destroying the hook)
  const leaveDaily = useCallback(async () => {
    if (callRef.current) {
      try {
        await callRef.current.leave();
        await callRef.current.destroy();
      } catch {}
      callRef.current = null;
      joinedRef.current = false;
      setIsDailyConnected(false);
      setRemoteStreams(new Map());
      setPeerStatuses(new Map());
      dailyToLocalId.current.clear();
      console.log("[Daily] Left room (idle timeout)");
    }
  }, []);

  // Rejoin Daily after a leave
  const rejoinDaily = useCallback(async () => {
    if (joinedRef.current) return;
    await joinDaily();
  }, [joinDaily]);

  // Auto-join on mount
  useEffect(() => {
    if (!roomId || !participantId || joinedRef.current) return;

    let cancelled = false;

    const doJoin = async () => {
      if (cancelled) return;
      await joinDaily();
    };

    doJoin();

    return () => {
      cancelled = true;
    };
  }, [roomId, participantId]);

  // Update audio input device when localStream changes
  useEffect(() => {
    if (!localStream || !callRef.current || !joinedRef.current) return;

    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      const deviceId = audioTrack.getSettings().deviceId;
      if (deviceId) {
        callRef.current.setInputDevicesAsync({ audioDeviceId: deviceId }).catch((e: any) => {
          console.warn("[Daily] Failed to update input device:", e);
        });
      }
    }
  }, [localStream]);

  // Rebuild streams when our participants list changes
  // participantsRef is updated above; trigger rebuild on participants array identity change
  useEffect(() => {
    if (callRef.current && joinedRef.current) {
      rebuildRemoteStreams(callRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (callRef.current) {
        callRef.current.leave().catch(() => {});
        callRef.current.destroy().catch(() => {});
        callRef.current = null;
        joinedRef.current = false;
      }
    };
  }, []);

  return { remoteStreams, peerStatuses, isDailyConnected, leaveDaily, rejoinDaily };
}
