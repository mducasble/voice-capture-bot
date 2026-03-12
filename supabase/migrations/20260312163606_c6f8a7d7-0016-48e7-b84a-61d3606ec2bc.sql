CREATE OR REPLACE FUNCTION public.expire_old_rooms()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  -- Expire rooms idle for more than 8 hours (existing behavior)
  UPDATE public.rooms
  SET status = 'expired',
      is_recording = false,
      updated_at = now()
  WHERE status IN ('waiting', 'active', 'live')
    AND created_at < now() - interval '8 hours';

  -- Safety net: expire rooms in waiting/active (never recorded) for >10 minutes
  UPDATE public.rooms
  SET status = 'expired',
      is_recording = false,
      idle_seconds_before_recording = EXTRACT(EPOCH FROM (now() - created_at))::integer,
      updated_at = now()
  WHERE status IN ('waiting', 'active')
    AND is_recording = false
    AND recording_started_at IS NULL
    AND created_at < now() - interval '10 minutes';

  -- Mark participants of newly expired rooms as disconnected
  UPDATE public.room_participants
  SET is_connected = false,
      left_at = COALESCE(left_at, now())
  WHERE room_id IN (
    SELECT id FROM public.rooms WHERE status = 'expired' AND updated_at >= now() - interval '1 minute'
  );
END;
$$;