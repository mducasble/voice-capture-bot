
-- Add accumulated_value to campaigns to track progress toward target
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS accumulated_value numeric NOT NULL DEFAULT 0;

-- Update the earnings trigger to also increment accumulated_value and pause campaign
CREATE OR REPLACE FUNCTION public.process_submission_earnings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_both_approved boolean;
  v_submission_type text;
  v_base_rate numeric;
  v_currency text;
  v_payment_type text;
  v_amount numeric;
  v_contribution numeric;
  v_earning_id uuid;
  v_ref_config record;
  v_referral record;
  v_pool_amount numeric;
  v_remaining numeric;
  v_level_user uuid;
  v_level_bonus numeric;
  v_lvl int;
  v_target numeric;
  v_new_accumulated numeric;
BEGIN
  -- Check if BOTH quality_status and validation_status are approved
  v_both_approved := (NEW.quality_status = 'approved' AND NEW.validation_status = 'approved');
  
  IF NOT v_both_approved THEN
    RETURN NEW;
  END IF;
  
  -- Prevent duplicate if already both approved
  IF OLD IS NOT NULL AND OLD.quality_status = 'approved' AND OLD.validation_status = 'approved' THEN
    RETURN NEW;
  END IF;

  -- Determine submission type
  CASE TG_TABLE_NAME
    WHEN 'voice_recordings' THEN v_submission_type := 'audio';
    WHEN 'image_submissions' THEN v_submission_type := 'image';
    WHEN 'video_submissions' THEN v_submission_type := 'video';
    WHEN 'text_submissions' THEN v_submission_type := 'text';
    WHEN 'annotation_submissions' THEN v_submission_type := 'annotation';
    ELSE v_submission_type := 'other';
  END CASE;

  -- Check duplicate
  IF EXISTS (
    SELECT 1 FROM public.earnings_ledger
    WHERE submission_id = NEW.id AND entry_type = 'task_payment'
  ) THEN
    RETURN NEW;
  END IF;

  -- Get reward config
  SELECT base_rate, currency, payment_type
  INTO v_base_rate, v_currency, v_payment_type
  FROM public.campaign_reward_config
  WHERE campaign_id = NEW.campaign_id;

  v_base_rate := COALESCE(v_base_rate, 0);
  v_currency := COALESCE(v_currency, 'USD');
  v_payment_type := COALESCE(v_payment_type, 'USD');

  -- Calculate contribution (hours for audio, 1 unit for others)
  IF v_submission_type = 'audio' AND NEW.duration_seconds IS NOT NULL AND NEW.duration_seconds > 0 THEN
    v_contribution := NEW.duration_seconds / 3600.0;
  ELSE
    v_contribution := 1;
  END IF;

  -- Calculate payment amount
  IF v_base_rate <= 0 THEN
    -- Even with no rate, still track contribution for campaign progress
    v_amount := 0;
  ELSE
    v_amount := round(v_base_rate * v_contribution, 4);
  END IF;

  -- Increment accumulated_value and check target
  UPDATE public.campaigns
  SET accumulated_value = accumulated_value + v_contribution,
      updated_at = now()
  WHERE id = NEW.campaign_id
  RETURNING accumulated_value, target_hours INTO v_new_accumulated, v_target;

  -- Pause campaign if target reached
  IF v_target IS NOT NULL AND v_target > 0 AND v_new_accumulated >= v_target THEN
    UPDATE public.campaigns
    SET campaign_status = 'paused', is_active = false, updated_at = now()
    WHERE id = NEW.campaign_id AND campaign_status != 'paused';
  END IF;

  -- Skip earnings if no rate
  IF v_amount <= 0 THEN
    RETURN NEW;
  END IF;

  -- Insert task payment
  INSERT INTO public.earnings_ledger (
    user_id, campaign_id, submission_id, submission_type,
    entry_type, amount, currency, status, description
  ) VALUES (
    NEW.user_id, NEW.campaign_id, NEW.id, v_submission_type,
    'task_payment', v_amount, v_currency, 'credited',
    'Auto-credited: ' || v_submission_type || ' submission approved'
  )
  RETURNING id INTO v_earning_id;

  -- ===== REFERRAL CASCADE =====
  SELECT pool_percent, pool_fixed_amount, cascade_keep_ratio, max_levels
  INTO v_ref_config
  FROM public.referral_config
  WHERE campaign_id = NEW.campaign_id;

  IF v_ref_config IS NULL THEN
    SELECT pool_percent, pool_fixed_amount, cascade_keep_ratio, max_levels
    INTO v_ref_config
    FROM public.referral_config
    WHERE campaign_id IS NULL
    LIMIT 1;
  END IF;

  IF v_ref_config IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_ref_config.pool_fixed_amount IS NOT NULL AND v_ref_config.pool_fixed_amount > 0 THEN
    v_pool_amount := v_ref_config.pool_fixed_amount;
  ELSE
    v_pool_amount := v_amount * (v_ref_config.pool_percent / 100.0);
  END IF;

  IF v_pool_amount <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT level_1, level_2, level_3, level_4, level_5
  INTO v_referral
  FROM public.referrals
  WHERE user_id = NEW.user_id;

  IF v_referral IS NULL THEN
    RETURN NEW;
  END IF;

  v_remaining := v_pool_amount;

  FOR v_lvl IN 1..LEAST(v_ref_config.max_levels, 5) LOOP
    CASE v_lvl
      WHEN 1 THEN v_level_user := v_referral.level_1;
      WHEN 2 THEN v_level_user := v_referral.level_2;
      WHEN 3 THEN v_level_user := v_referral.level_3;
      WHEN 4 THEN v_level_user := v_referral.level_4;
      WHEN 5 THEN v_level_user := v_referral.level_5;
    END CASE;

    IF v_level_user IS NULL THEN EXIT; END IF;

    v_level_bonus := round(v_remaining * v_ref_config.cascade_keep_ratio, 4);
    IF v_level_bonus <= 0 THEN EXIT; END IF;

    INSERT INTO public.earnings_ledger (
      user_id, campaign_id, submission_id, submission_type,
      entry_type, amount, currency, status, description, reference_id
    ) VALUES (
      v_level_user, NEW.campaign_id, NEW.id, v_submission_type,
      'referral_bonus', v_level_bonus, v_currency, 'credited',
      'Referral L' || v_lvl || ' bonus from ' || v_submission_type,
      v_earning_id
    );

    v_remaining := v_remaining - v_level_bonus;
    IF v_remaining <= 0 THEN EXIT; END IF;
  END LOOP;

  RETURN NEW;
END;
$$;
