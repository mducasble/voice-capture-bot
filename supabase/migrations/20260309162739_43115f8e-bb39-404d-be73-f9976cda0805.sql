DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name, referral_code, country, city)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    substr(md5(NEW.id::text || random()::text), 1, 8),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'country'), ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'city'), '')
  );
  RETURN NEW;
END;
$function$;

-- Re-attach trigger
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();