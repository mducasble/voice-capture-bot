import { supabase } from "@/integrations/supabase/client";

export async function processReferralOnSignup(newUserId: string) {
  const referralCode = localStorage.getItem("referral_code");
  if (!referralCode) return;

  try {
    // Find referrer by code
    const { data: referrer } = await (supabase as any)
      .from("profiles")
      .select("id")
      .eq("referral_code", referralCode)
      .single();

    if (!referrer || referrer.id === newUserId) {
      localStorage.removeItem("referral_code");
      return;
    }

    // Get referrer's own referral chain (if they were referred too)
    const { data: referrerChain } = await (supabase as any)
      .from("referrals")
      .select("level_1, level_2, level_3, level_4")
      .eq("user_id", referrer.id)
      .single();

    // Build levels: shift referrer's chain up
    const levels = {
      level_1: referrer.id,
      level_2: referrerChain?.level_1 || null,
      level_3: referrerChain?.level_2 || null,
      level_4: referrerChain?.level_3 || null,
      level_5: referrerChain?.level_4 || null,
    };

    await (supabase as any).from("referrals").insert({
      user_id: newUserId,
      referred_by: referrer.id,
      ...levels,
    });

    localStorage.removeItem("referral_code");
  } catch (err) {
    console.warn("Referral processing failed:", err);
  }
}
