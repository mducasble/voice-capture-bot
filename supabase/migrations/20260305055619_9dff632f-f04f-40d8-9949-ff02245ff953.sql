ALTER TABLE public.rooms 
  ADD COLUMN topic text DEFAULT NULL,
  ADD COLUMN duration_minutes integer DEFAULT NULL;