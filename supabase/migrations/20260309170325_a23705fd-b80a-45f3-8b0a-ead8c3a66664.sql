UPDATE voice_recordings 
SET status = 'completed'
WHERE session_id::text LIKE '60c23eaf%'
AND status IN ('processing', 'failed');