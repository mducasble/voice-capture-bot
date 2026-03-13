
CREATE OR REPLACE FUNCTION public.get_referral_network_stats()
RETURNS TABLE (
  user_id uuid,
  full_name text,
  email_contact text,
  country text,
  referral_code text,
  level_1_count bigint,
  level_2_count bigint,
  level_3_count bigint,
  level_4_count bigint,
  level_5_count bigint,
  total_network bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id AS user_id,
    p.full_name,
    p.email_contact,
    p.country,
    p.referral_code,
    COALESCE(s.l1, 0) AS level_1_count,
    COALESCE(s.l2, 0) AS level_2_count,
    COALESCE(s.l3, 0) AS level_3_count,
    COALESCE(s.l4, 0) AS level_4_count,
    COALESCE(s.l5, 0) AS level_5_count,
    COALESCE(s.l1, 0) + COALESCE(s.l2, 0) + COALESCE(s.l3, 0) + COALESCE(s.l4, 0) + COALESCE(s.l5, 0) AS total_network
  FROM public.profiles p
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (WHERE r.level_1 = p.id) AS l1,
      COUNT(*) FILTER (WHERE r.level_2 = p.id) AS l2,
      COUNT(*) FILTER (WHERE r.level_3 = p.id) AS l3,
      COUNT(*) FILTER (WHERE r.level_4 = p.id) AS l4,
      COUNT(*) FILTER (WHERE r.level_5 = p.id) AS l5
    FROM public.referrals r
    WHERE r.level_1 = p.id OR r.level_2 = p.id OR r.level_3 = p.id OR r.level_4 = p.id OR r.level_5 = p.id
  ) s ON true
  WHERE COALESCE(s.l1, 0) + COALESCE(s.l2, 0) + COALESCE(s.l3, 0) + COALESCE(s.l4, 0) + COALESCE(s.l5, 0) > 0
  ORDER BY total_network DESC;
$$;
