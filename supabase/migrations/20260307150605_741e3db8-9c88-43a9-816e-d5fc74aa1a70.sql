
-- Create function to auto-expire rooms older than 8 hours
CREATE OR REPLACE FUNCTION public.expire_old_rooms()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Update rooms older than 8h that are still open
  UPDATE public.rooms
  SET status = 'expired',
      is_recording = false,
      updated_at = now()
  WHERE status IN ('waiting', 'active', 'live')
    AND created_at < now() - interval '8 hours';

  -- Mark participants of expired rooms as disconnected
  UPDATE public.room_participants
  SET is_connected = false,
      left_at = COALESCE(left_at, now())
  WHERE room_id IN (
    SELECT id FROM public.rooms WHERE status = 'expired' AND updated_at >= now() - interval '1 minute'
  );
END;
$$;

-- Enable pg_cron and pg_net extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
