-- Drop the authenticated-only insert policy
DROP POLICY IF EXISTS "Allow authenticated upload to voice recordings" ON storage.objects;

-- Create a public insert policy for voice-recordings bucket
CREATE POLICY "Allow public upload to voice recordings"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'voice-recordings');