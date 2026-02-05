-- Create rooms table for audio recording sessions
CREATE TABLE public.rooms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  creator_name TEXT NOT NULL,
  room_name TEXT,
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting, recording, completed
  session_id UUID DEFAULT gen_random_uuid(),
  is_recording BOOLEAN DEFAULT false,
  recording_started_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create room participants table
CREATE TABLE public.room_participants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_creator BOOLEAN DEFAULT false,
  is_connected BOOLEAN DEFAULT true,
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  left_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_participants ENABLE ROW LEVEL SECURITY;

-- RLS policies for rooms (public access via link)
CREATE POLICY "Allow public read for rooms" 
ON public.rooms FOR SELECT USING (true);

CREATE POLICY "Allow public insert for rooms" 
ON public.rooms FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update for rooms" 
ON public.rooms FOR UPDATE USING (true);

-- RLS policies for participants
CREATE POLICY "Allow public read for participants" 
ON public.room_participants FOR SELECT USING (true);

CREATE POLICY "Allow public insert for participants" 
ON public.room_participants FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update for participants" 
ON public.room_participants FOR UPDATE USING (true);

CREATE POLICY "Allow public delete for participants" 
ON public.room_participants FOR DELETE USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_rooms_updated_at
BEFORE UPDATE ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for rooms and participants
ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_participants;