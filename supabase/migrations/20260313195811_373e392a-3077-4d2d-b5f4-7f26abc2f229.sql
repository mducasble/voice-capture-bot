
CREATE OR REPLACE FUNCTION public.get_network_members_with_sessions(p_user_id uuid)
RETURNS TABLE(
  user_id uuid,
  full_name text,
  country text,
  level int,
  session_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH members AS (
    SELECT
      r.user_id,
      CASE
        WHEN r.level_1 = p_user_id THEN 1
        WHEN r.level_2 = p_user_id THEN 2
        WHEN r.level_3 = p_user_id THEN 3
        WHEN r.level_4 = p_user_id THEN 4
        WHEN r.level_5 = p_user_id THEN 5
      END AS level
    FROM public.referrals r
    WHERE r.level_1 = p_user_id
       OR r.level_2 = p_user_id
       OR r.level_3 = p_user_id
       OR r.level_4 = p_user_id
       OR r.level_5 = p_user_id
  ),
  sessions AS (
    SELECT
      vr.user_id,
      COUNT(DISTINCT vr.session_id) AS session_count
    FROM public.voice_recordings vr
    WHERE vr.user_id IN (SELECT m.user_id FROM members m)
      AND vr.recording_type = 'individual'
    GROUP BY vr.user_id
  )
  SELECT
    m.user_id,
    p.full_name,
    p.country,
    m.level,
    COALESCE(s.session_count, 0) AS session_count
  FROM members m
  LEFT JOIN public.profiles p ON p.id = m.user_id
  LEFT JOIN sessions s ON s.user_id = m.user_id
  ORDER BY m.level, s.session_count DESC NULLS LAST;
$$;
