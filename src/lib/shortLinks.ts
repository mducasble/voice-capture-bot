import { supabase } from "@/integrations/supabase/client";

/**
 * Generate a short slug (6 chars) and store it mapped to the given path.
 * Returns the full short URL.
 */
export async function createShortLink(targetPath: string): Promise<string> {
  const slug = generateSlug();

  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("short_links")
    .insert({ slug, target_path: targetPath, created_by: user?.id ?? null } as any);

  if (error) {
    // If slug collision, try once more
    const slug2 = generateSlug();
    await supabase
      .from("short_links")
      .insert({ slug: slug2, target_path: targetPath, created_by: user?.id ?? null } as any);
    return `${window.location.origin}/r/${slug2}`;
  }

  return `${window.location.origin}/r/${slug}`;
}

function generateSlug(): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let result = "";
  const array = new Uint8Array(6);
  crypto.getRandomValues(array);
  for (let i = 0; i < 6; i++) {
    result += chars[array[i] % chars.length];
  }
  return result;
}
