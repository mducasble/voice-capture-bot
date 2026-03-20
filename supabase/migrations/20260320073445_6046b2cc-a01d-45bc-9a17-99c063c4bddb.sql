
-- When quality_status is approved on voice_recordings, auto-approve validation_status
CREATE OR REPLACE FUNCTION public.auto_approve_voice_validation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only act when quality_status just changed to 'approved'
  IF NEW.quality_status = 'approved'
     AND (OLD.quality_status IS DISTINCT FROM 'approved')
     AND (NEW.validation_status IS DISTINCT FROM 'approved')
  THEN
    NEW.validation_status := 'approved';
  END IF;
  RETURN NEW;
END;
$$;

-- BEFORE trigger so it modifies the row before the earnings AFTER trigger fires
CREATE TRIGGER trg_auto_approve_voice_validation
  BEFORE UPDATE OF quality_status ON public.voice_recordings
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_approve_voice_validation();
