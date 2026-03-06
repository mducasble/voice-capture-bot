
CREATE OR REPLACE FUNCTION public.process_referral(p_user_id uuid, p_referral_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer_id uuid;
  v_chain record;
BEGIN
  -- Find referrer by code
  SELECT id INTO v_referrer_id
  FROM public.profiles
  WHERE referral_code = p_referral_code;

  IF v_referrer_id IS NULL OR v_referrer_id = p_user_id THEN
    RETURN false;
  END IF;

  -- Check if referral already exists for this user
  IF EXISTS (SELECT 1 FROM public.referrals WHERE user_id = p_user_id) THEN
    RETURN false;
  END IF;

  -- Get referrer's chain
  SELECT level_1, level_2, level_3, level_4
  INTO v_chain
  FROM public.referrals
  WHERE user_id = v_referrer_id;

  -- Insert referral with cascaded levels
  INSERT INTO public.referrals (user_id, referred_by, level_1, level_2, level_3, level_4, level_5)
  VALUES (
    p_user_id,
    v_referrer_id,
    v_referrer_id,
    v_chain.level_1,
    v_chain.level_2,
    v_chain.level_3,
    v_chain.level_4
  );

  RETURN true;
END;
$$;
