-- Allow delete via service role (for edge functions) and public delete for now
CREATE POLICY "Allow delete for recordings" 
ON public.voice_recordings 
FOR DELETE 
USING (true);