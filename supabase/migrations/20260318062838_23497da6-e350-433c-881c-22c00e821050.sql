
-- 1. Revert Matue Arruda's self-approved audio submissions back to pending
UPDATE public.voice_recordings
SET 
  quality_status = 'pending',
  quality_reviewed_by = NULL,
  quality_reviewed_at = NULL,
  validation_status = 'pending',
  validation_reviewed_by = NULL,
  validation_reviewed_at = NULL
WHERE id IN (
  '205033a2-0f75-48c4-b768-e252873112d2',
  'd6d842ee-bb9f-496f-a7d9-a3668ec38008',
  '1f046d6a-257a-44a8-a709-f92954c1e588',
  'f8c8079c-e754-488f-b047-67020719fec4',
  '3b53bdaa-70d6-4891-889c-906eb04df73f',
  '72a5fbbf-7b8b-434f-9de9-52d86fffe91b',
  '1585bd54-9b4a-4f54-aa60-9dd19b3e48f5',
  '258111dc-9ddd-49b2-bbd4-a3c9c4a1d0ec',
  '188c9f66-4d95-48c5-b2d7-9a0ecbeac80e'
);

-- 2. Delete the credited earnings for those submissions
DELETE FROM public.earnings_ledger
WHERE id IN (
  '61804778-78a8-4c2a-9c32-7c05a5a5d735',
  'b099bd8b-7943-4d12-86c3-30d6bd04797b',
  '68e06fa1-d424-44f7-9bec-f42fbb3dfbef',
  '23a72b3c-5d0b-4789-bdc2-8d718b7a50f3',
  '72125d82-8961-417d-9d9d-33bbc542160a',
  '505a5bed-20e5-4251-9f7f-937c0ec44f3b',
  'd47ca60a-fa1b-4087-b101-ac3b371cd188',
  'd51243b8-91d3-4852-a8ca-690f61d264fc',
  '096be396-42f2-4329-ac96-4905eab008e9'
);

-- 3. Prevent self-review: block users from approving their own voice_recordings
CREATE OR REPLACE FUNCTION public.prevent_self_review_voice()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Check quality review
  IF NEW.quality_reviewed_by IS NOT NULL 
     AND NEW.quality_reviewed_by = NEW.user_id 
     AND (OLD.quality_reviewed_by IS NULL OR OLD.quality_reviewed_by != NEW.quality_reviewed_by) THEN
    RAISE EXCEPTION 'Self-review not allowed: reviewer cannot be the submission author';
  END IF;
  -- Check validation review
  IF NEW.validation_reviewed_by IS NOT NULL 
     AND NEW.validation_reviewed_by = NEW.user_id 
     AND (OLD.validation_reviewed_by IS NULL OR OLD.validation_reviewed_by != NEW.validation_reviewed_by) THEN
    RAISE EXCEPTION 'Self-review not allowed: reviewer cannot be the submission author';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_review_voice ON public.voice_recordings;
CREATE TRIGGER trg_prevent_self_review_voice
  BEFORE UPDATE ON public.voice_recordings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_review_voice();

-- 4. Same for image_submissions
CREATE OR REPLACE FUNCTION public.prevent_self_review_image()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.quality_reviewed_by IS NOT NULL 
     AND NEW.quality_reviewed_by = NEW.user_id 
     AND (OLD.quality_reviewed_by IS NULL OR OLD.quality_reviewed_by != NEW.quality_reviewed_by) THEN
    RAISE EXCEPTION 'Self-review not allowed: reviewer cannot be the submission author';
  END IF;
  IF NEW.validation_reviewed_by IS NOT NULL 
     AND NEW.validation_reviewed_by = NEW.user_id 
     AND (OLD.validation_reviewed_by IS NULL OR OLD.validation_reviewed_by != NEW.validation_reviewed_by) THEN
    RAISE EXCEPTION 'Self-review not allowed: reviewer cannot be the submission author';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_review_image ON public.image_submissions;
CREATE TRIGGER trg_prevent_self_review_image
  BEFORE UPDATE ON public.image_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_review_image();

-- 5. Same for text_submissions
CREATE OR REPLACE FUNCTION public.prevent_self_review_text()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.quality_reviewed_by IS NOT NULL 
     AND NEW.quality_reviewed_by = NEW.user_id 
     AND (OLD.quality_reviewed_by IS NULL OR OLD.quality_reviewed_by != NEW.quality_reviewed_by) THEN
    RAISE EXCEPTION 'Self-review not allowed: reviewer cannot be the submission author';
  END IF;
  IF NEW.validation_reviewed_by IS NOT NULL 
     AND NEW.validation_reviewed_by = NEW.user_id 
     AND (OLD.validation_reviewed_by IS NULL OR OLD.validation_reviewed_by != NEW.validation_reviewed_by) THEN
    RAISE EXCEPTION 'Self-review not allowed: reviewer cannot be the submission author';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_review_text ON public.text_submissions;
CREATE TRIGGER trg_prevent_self_review_text
  BEFORE UPDATE ON public.text_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_review_text();

-- 6. Same for annotation_submissions
CREATE OR REPLACE FUNCTION public.prevent_self_review_annotation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.quality_reviewed_by IS NOT NULL 
     AND NEW.quality_reviewed_by = NEW.user_id 
     AND (OLD.quality_reviewed_by IS NULL OR OLD.quality_reviewed_by != NEW.quality_reviewed_by) THEN
    RAISE EXCEPTION 'Self-review not allowed: reviewer cannot be the submission author';
  END IF;
  IF NEW.validation_reviewed_by IS NOT NULL 
     AND NEW.validation_reviewed_by = NEW.user_id 
     AND (OLD.validation_reviewed_by IS NULL OR OLD.validation_reviewed_by != NEW.validation_reviewed_by) THEN
    RAISE EXCEPTION 'Self-review not allowed: reviewer cannot be the submission author';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_review_annotation ON public.annotation_submissions;
CREATE TRIGGER trg_prevent_self_review_annotation
  BEFORE UPDATE ON public.annotation_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_review_annotation();
