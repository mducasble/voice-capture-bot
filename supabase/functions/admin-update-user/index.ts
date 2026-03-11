import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization")!;

    // Verify caller is admin
    const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: roleCheck } = await callerClient.rpc("has_role", { _user_id: caller.id, _role: "admin" });
    if (!roleCheck) return new Response(JSON.stringify({ error: "Not admin" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json();
    const { action, user_id, profile_data, new_password } = body;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    if (action === "update_profile") {
      const { error } = await adminClient.from("profiles").update(profile_data).eq("id", user_id);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "reset_password") {
      // Get user email first
      const { data: userData, error: userError } = await adminClient.auth.admin.getUserById(user_id);
      if (userError || !userData?.user?.email) throw new Error("User not found");

      if (new_password) {
        // Direct password update
        const { error } = await adminClient.auth.admin.updateUserById(user_id, { password: new_password });
        if (error) throw error;
        return new Response(JSON.stringify({ success: true, method: "direct" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } else {
        // Send password reset email
        const { error } = await adminClient.auth.resetPasswordForEmail(userData.user.email, {
          redirectTo: `${req.headers.get("origin") || "https://voice-tracker.lovable.app"}/auth`,
        });
        if (error) throw error;
        return new Response(JSON.stringify({ success: true, method: "email" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (action === "get_user_email") {
      const { data: userData, error } = await adminClient.auth.admin.getUserById(user_id);
      if (error || !userData?.user) {
        return new Response(JSON.stringify({ email: null }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ email: userData.user.email }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "delete_user") {
      // Delete related data first, then auth user
      await adminClient.from("earnings_ledger").delete().eq("user_id", user_id);
      await adminClient.from("referrals").delete().eq("user_id", user_id);
      await adminClient.from("campaign_participants").delete().eq("user_id", user_id);
      await adminClient.from("campaign_waitlist").delete().eq("user_id", user_id);
      await adminClient.from("user_roles").delete().eq("user_id", user_id);
      await adminClient.from("profiles").delete().eq("id", user_id);
      // Auth user may not exist if already partially deleted
      const { error } = await adminClient.auth.admin.deleteUser(user_id);
      if (error && !error.message.includes("not found")) throw error;
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
