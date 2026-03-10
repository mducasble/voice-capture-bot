ALTER TABLE public.campaign_audio_validation
  ADD COLUMN mq_threshold numeric DEFAULT NULL,
  ADD COLUMN hq_threshold numeric DEFAULT NULL,
  ADD COLUMN pq_threshold numeric DEFAULT NULL;