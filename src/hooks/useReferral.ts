import { supabase } from "@/integrations/supabase/client";

export async function processReferralOnSignup(newUserId: string) {
  const referralCode = localStorage.getItem("referral_code");
  if (!referralCode) return;

  try {
    const { data, error } = await supabase.rpc("process_referral" as any, {
      p_user_id: newUserId,
      p_referral_code: referralCode,
    });

    if (error) {
      console.warn("Referral processing failed:", error);
    } else {
      console.log("Referral processed:", data);
    }

    localStorage.removeItem("referral_code");
  } catch (err) {
    console.warn("Referral processing failed:", err);
  }
}
