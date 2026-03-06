-- Backfill user_id on room_participants from profiles by matching name
UPDATE public.room_participants rp
SET user_id = p.id
FROM public.profiles p
WHERE rp.name = p.full_name AND rp.user_id IS NULL;