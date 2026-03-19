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

    // Get target user IDs based on mode
    let userIds: string[] = [];

    if (mode === "all") {
      const { data } = await supabaseAdmin
        .from("profiles")
        .select("id");
      userIds = (data || []).map((p: any) => p.id);
    } else if (mode === "country" && country) {
      const { data } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("country", country);
      userIds = (data || []).map((p: any) => p.id);
    } else if (mode === "campaign" && campaign_id) {
      const { data } = await supabaseAdmin
        .from("campaign_participants")
        .select("user_id")
        .eq("campaign_id", campaign_id);
      userIds = (data || []).map((p: any) => p.user_id);
    } else {
      throw new Error("Invalid mode or missing parameters");
    }

    // Deduplicate and exclude the admin sender
    userIds = [...new Set(userIds)].filter(id => id !== user.id);

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

      // Insert messages
      const messages = (insertedThreads || []).map((t: any) => ({
        thread_id: t.id,
        sender_id: user.id,
        body,
      }));

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
