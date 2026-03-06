
-- Add video and PDF fields to campaign_instructions
ALTER TABLE public.campaign_instructions 
  ADD COLUMN video_url text DEFAULT NULL,
  ADD COLUMN pdf_file_url text DEFAULT NULL;

-- Create storage bucket for campaign instruction PDFs
INSERT INTO storage.buckets (id, name, public) VALUES ('campaign-files', 'campaign-files', true);

-- Storage RLS: anyone can read, authenticated can upload
CREATE POLICY "Public read campaign-files" ON storage.objects FOR SELECT USING (bucket_id = 'campaign-files');
CREATE POLICY "Authenticated upload campaign-files" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'campaign-files');
CREATE POLICY "Authenticated update campaign-files" ON storage.objects FOR UPDATE USING (bucket_id = 'campaign-files');
CREATE POLICY "Authenticated delete campaign-files" ON storage.objects FOR DELETE USING (bucket_id = 'campaign-files');
