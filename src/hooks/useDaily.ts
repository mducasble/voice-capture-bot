import { useEffect, useRef, useCallback, useState } from "react";
import DailyIframe, {
  DailyCall,
  DailyEventObjectParticipant,
  DailyEventObjectParticipantLeft,
  DailyEventObjectTrack,
} from "@daily-co/daily-js";
import { supabase } from "@/integrations/supabase/client";

export type PeerConnectionStatus = "connecting" | "connected" | "reconnecting" | "failed";

interface UseDailyOptions {
  roomId: string | undefined;
  participantId: string | undefined;
  localStream: MediaStream | null;
  participants: { id: string; name: string }[];
}

/**
 * useDaily — drop-in replacement for useWebRTC using Daily.co SFU.
 * Returns the same interface: { remoteStreams, peerStatuses }
 */
export function useDaily({ roomId, participantId, localStream, participants }: UseDailyOptions) {
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [peerStatuses, setPeerStatuses] = useState<Map<string, PeerConnectionStatus>>(new Map());
  const callRef = useRef<DailyCall | null>(null);
  const joinedRef = useRef(false);
  const participantIdRef = useRef<string | undefined>();
  // Map Daily session_id → our participant ID
  const dailyToLocalId = useRef<Map<string, string>>(new Map());

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
  const rebuildRemoteStreams = useCallback((call: DailyCall) => {
    const dailyParticipants = call.participants();
    const newStreams = new Map<string, MediaStream>();

    for (const [sessionId, dp] of Object.entries(dailyParticipants)) {
      if (sessionId === "local") continue;
      
      // Try to match Daily participant to our participant by name
      const dailyName = dp.user_name || "";
      const matchedParticipant = participants.find(p => p.name === dailyName && p.id !== participantIdRef.current);
      const localId = matchedParticipant?.id || sessionId;
      
      dailyToLocalId.current.set(sessionId, localId);

      // Get the audio track
      const audioTrack = dp.tracks?.audio;
      if (audioTrack?.persistentTrack) {
        const stream = new MediaStream([audioTrack.persistentTrack]);
        newStreams.set(localId, stream);
        updatePeerStatus(localId, "connected");
      } else if (audioTrack?.state === "loading" || audioTrack?.state === "sendable") {
        updatePeerStatus(localId, "connecting");
      }
    }

    setRemoteStreams(newStreams);
  }, [participants, updatePeerStatus]);

  // Join the Daily room
  useEffect(() => {
    if (!roomId || !participantId || joinedRef.current) return;

    let cancelled = false;

    const joinDaily = async () => {
      try {
        // Get Daily token from our edge function
        const { data: { session } } = await supabase.auth.getSession();
        const authToken = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

        // Find participant name
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
          console.error("[Daily] Failed to get token:", errText);
          return;
        }

        const { token, room_url } = await res.json();

        if (cancelled) return;

        // Create Daily call object
        const call = DailyIframe.createCallObject({
          audioSource: true,
          videoSource: false,
          dailyConfig: {},
        });

        callRef.current = call;

        // Set up event handlers
        call.on("participant-joined", (event?: DailyEventObjectParticipant) => {
          if (!event) return;
          console.log(`[Daily] Participant joined: ${event.participant.user_name}`);
          rebuildRemoteStreams(call);
        });

        call.on("participant-left", (event?: DailyEventObjectParticipantLeft) => {
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

        call.on("track-started", (event?: DailyEventObjectTrack) => {
          if (!event) return;
          console.log(`[Daily] Track started: ${event.track.kind} from ${event.participant?.user_name}`);
          rebuildRemoteStreams(call);
        });

        call.on("track-stopped", (event?: DailyEventObjectTrack) => {
          if (!event) return;
          console.log(`[Daily] Track stopped: ${event.track.kind}`);
          rebuildRemoteStreams(call);
        });

        call.on("error", (event) => {
          console.error("[Daily] Error:", event);
        });

        call.on("network-quality-change", (event) => {
          if (event && event.threshold === "very-low") {
            console.warn("[Daily] Network quality very low");
          }
        });

        // Join the room
        await call.join({
          url: room_url,
          token,
          userName: participantName,
          startVideoOff: true,
          startAudioOff: false,
        });

        joinedRef.current = true;
        console.log("[Daily] Joined room successfully");

        // Set input device from localStream if available
        if (localStream) {
          const audioTrack = localStream.getAudioTracks()[0];
          if (audioTrack) {
            const deviceId = audioTrack.getSettings().deviceId;
            if (deviceId) {
              await call.setInputDevicesAsync({ audioDeviceId: deviceId });
            }
          }
        }

        // Initial build of remote streams
        rebuildRemoteStreams(call);

      } catch (error) {
        console.error("[Daily] Join error:", error);
      }
    };

    joinDaily();

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
        callRef.current.setInputDevicesAsync({ audioDeviceId: deviceId }).catch(e => {
          console.warn("[Daily] Failed to update input device:", e);
        });
      }
    }
  }, [localStream]);

  // Rebuild streams when our participants list changes (to improve name matching)
  useEffect(() => {
    if (callRef.current && joinedRef.current) {
      rebuildRemoteStreams(callRef.current);
    }
  }, [participants, rebuildRemoteStreams]);

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

  return { remoteStreams, peerStatuses };
}
