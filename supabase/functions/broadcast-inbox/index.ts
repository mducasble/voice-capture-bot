import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("Missing auth header");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Verify caller is admin
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const { data: roleCheck } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleCheck) throw new Error("Forbidden: admin role required");

    const { mode, subject, body, category, country, campaign_id } = await req.json();

    if (!subject?.trim() || !body?.trim()) {
      throw new Error("Subject and body are required");
    }

    // Get target users with profile data for placeholder replacement
    let profiles: { id: string; full_name: string | null; wallet_id: string | null; country: string | null; email_contact: string | null }[] = [];

    if (mode === "all") {
      const { data } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, wallet_id, country, email_contact");
      profiles = (data || []) as any;
    } else if (mode === "country" && country) {
      const { data } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, wallet_id, country, email_contact")
        .eq("country", country);
      profiles = (data || []) as any;
    } else if (mode === "campaign" && campaign_id) {
      const { data: participants } = await supabaseAdmin
        .from("campaign_participants")
        .select("user_id")
        .eq("campaign_id", campaign_id);
      const pUserIds = (participants || []).map((p: any) => p.user_id);
      if (pUserIds.length > 0) {
        const { data } = await supabaseAdmin
          .from("profiles")
          .select("id, full_name, wallet_id, country, email_contact")
          .in("id", pUserIds);
        profiles = (data || []) as any;
      }
    } else {
      throw new Error("Invalid mode or missing parameters");
    }

    // Deduplicate
    const seen = new Set<string>();
    profiles = profiles.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
    let userIds = profiles.map(p => p.id);
    const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));

    const replacePlaceholders = (text: string, profile: typeof profiles[0]) => {
      return text
        .replace(/\[NOME\]/g, profile.full_name || "")
        .replace(/\[WALLET_ADDRESS\]/g, profile.wallet_id || "")
        .replace(/\[COUNTRY\]/g, profile.country || "")
        .replace(/\[EMAIL\]/g, profile.email_contact || "");
    };

    // Deduplicate
    userIds = [...new Set(userIds)];

    if (userIds.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent_count: 0, message: "No users matched the criteria" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Batch insert threads and messages
    const now = new Date().toISOString();
    let sentCount = 0;
    const batchSize = 100;

    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);

      // Insert threads
      const threads = batch.map(uid => ({
        user_id: uid,
        subject,
        category: category || "general",
        created_by: user.id,
        last_message_at: now,
      }));

      const { data: insertedThreads, error: tErr } = await supabaseAdmin
        .from("inbox_threads")
        .insert(threads)
        .select("id, user_id");

      if (tErr) {
        console.error("Thread insert error:", tErr);
        continue;
      }

      // Insert messages with personalized body
      const messages = (insertedThreads || []).map((t: any) => {
        const profile = profileMap[t.user_id];
        return {
          thread_id: t.id,
          sender_id: user.id,
          body: profile ? replacePlaceholders(body, profile) : body,
        };
      });

      const { error: mErr } = await supabaseAdmin
        .from("inbox_messages")
        .insert(messages);

      if (mErr) {
        console.error("Message insert error:", mErr);
        continue;
      }

      sentCount += batch.length;
    }

    return new Response(
      JSON.stringify({ success: true, sent_count: sentCount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Broadcast error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
