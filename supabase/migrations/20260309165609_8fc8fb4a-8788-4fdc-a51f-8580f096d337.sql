UPDATE voice_recordings 
SET status = 'failed'
WHERE id IN ('60c23eaf-7deb-412c-b4fd-919651343322', 'ede1ad05-30c6-42ba-b701-d8e5994cc707')
AND status = 'processing';