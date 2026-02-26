
ALTER TABLE public.campaigns RENAME COLUMN target_recordings TO target_hours;
ALTER TABLE public.campaigns ALTER COLUMN target_hours TYPE numeric USING target_hours::numeric;

ALTER TABLE public.campaign_sections RENAME COLUMN target_recordings TO target_hours;
ALTER TABLE public.campaign_sections ALTER COLUMN target_hours TYPE numeric USING target_hours::numeric;
