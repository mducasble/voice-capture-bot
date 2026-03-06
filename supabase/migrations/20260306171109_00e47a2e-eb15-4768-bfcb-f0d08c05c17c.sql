
DROP FUNCTION public.get_my_campaign_recordings(uuid, uuid[]);

CREATE OR REPLACE FUNCTION public.get_my_campaign_recordings(p_user_id uuid, p_campaign_ids uuid[])
RETURNS TABLE(
  id uuid,
  filename text,
  duration_seconds numeric,
  recording_type text,
  session_id uuid,
  created_at timestamptz,
  discord_username text,
  file_url text,
  status text,
  campaign_id uuid,
  quality_status text,
  validation_status text,
  snr_db numeric,
  quality_rejection_reason text,
  validation_rejection_reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT vr.id, vr.filename, vr.duration_seconds, vr.recording_type, vr.session_id,
         vr.created_at, vr.discord_username, vr.file_url, vr.status::text, vr.campaign_id,
         vr.quality_status, vr.validation_status, vr.snr_db,
         vr.quality_rejection_reason, vr.validation_rejection_reason
  FROM public.voice_recordings vr
  WHERE vr.campaign_id = ANY(p_campaign_ids)
    AND (
      vr.user_id = p_user_id
      OR vr.session_id IN (
        SELECT r.session_id FROM public.rooms r
        JOIN public.room_participants rp ON rp.room_id = r.id
        WHERE rp.user_id = p_user_id
      )
    )
  ORDER BY vr.created_at DESC;
$$;
