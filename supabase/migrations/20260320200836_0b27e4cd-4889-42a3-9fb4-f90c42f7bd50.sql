
-- Add public room support columns
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.campaigns(id),
  ADD COLUMN IF NOT EXISTS creator_user_id uuid;

-- Table for join requests
CREATE TABLE public.room_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  user_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending, approved, rejected
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE(room_id, user_id)
);

ALTER TABLE public.room_join_requests ENABLE ROW LEVEL SECURITY;

-- Host (room creator) can see all requests for their rooms
CREATE POLICY "Room creators can view join requests"
  ON public.room_join_requests FOR SELECT
  TO authenticated
  USING (
    room_id IN (SELECT id FROM public.rooms WHERE creator_user_id = auth.uid())
    OR user_id = auth.uid()
  );

-- Users can request to join
CREATE POLICY "Users can request to join"
  ON public.room_join_requests FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Host can approve/reject
CREATE POLICY "Room creators can update join requests"
  ON public.room_join_requests FOR UPDATE
  TO authenticated
  USING (
    room_id IN (SELECT id FROM public.rooms WHERE creator_user_id = auth.uid())
  );

-- Allow authenticated users to see public rooms
CREATE POLICY "Anyone can see public rooms"
  ON public.rooms FOR SELECT
  TO authenticated
  USING (is_public = true OR creator_user_id = auth.uid());

-- Enable realtime for join requests so host gets notified
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_join_requests;
