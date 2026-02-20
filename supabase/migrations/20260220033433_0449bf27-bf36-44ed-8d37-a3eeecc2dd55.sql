
-- Table for WebRTC signaling (offers, answers, ICE candidates)
CREATE TABLE public.webrtc_signals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.room_participants(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES public.room_participants(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('offer', 'answer', 'ice')),
  signal_data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for fast lookups by receiver
CREATE INDEX idx_webrtc_signals_receiver ON public.webrtc_signals(receiver_id, room_id);

-- Enable RLS (public access since no auth)
ALTER TABLE public.webrtc_signals ENABLE ROW LEVEL SECURITY;

-- Allow all operations (no auth in this app)
CREATE POLICY "Anyone can insert signals" ON public.webrtc_signals FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read signals" ON public.webrtc_signals FOR SELECT USING (true);
CREATE POLICY "Anyone can delete signals" ON public.webrtc_signals FOR DELETE USING (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.webrtc_signals;

-- Auto-cleanup old signals (older than 1 hour)
CREATE OR REPLACE FUNCTION public.cleanup_old_signals()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.webrtc_signals WHERE created_at < now() - interval '1 hour';
  RETURN NEW;
END;
$$;

CREATE TRIGGER cleanup_signals_trigger
AFTER INSERT ON public.webrtc_signals
FOR EACH STATEMENT
EXECUTE FUNCTION public.cleanup_old_signals();
