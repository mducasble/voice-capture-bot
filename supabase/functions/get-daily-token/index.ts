import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-bot-api-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const DAILY_API_KEY = Deno.env.get('DAILY_API_KEY');
    if (!DAILY_API_KEY) {
      throw new Error('DAILY_API_KEY not configured');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Auth check
    const botApiKey = req.headers.get('x-bot-api-key');
    const expectedApiKey = Deno.env.get('BOT_API_KEY');
    const authHeader = req.headers.get('authorization');

    let authUserId: string | null = null;

    if (botApiKey && botApiKey === expectedApiKey) {
      // Bot auth OK
    } else if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      if (!user) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      authUserId = user.id;
    } else {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { room_id, participant_name } = await req.json();

    if (!room_id) {
      return new Response(
        JSON.stringify({ error: 'room_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Daily room name from our rooms table
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('daily_room_name')
      .eq('id', room_id)
      .single();

    if (roomError || !room?.daily_room_name) {
      return new Response(
        JSON.stringify({ error: 'Room not found or Daily room not configured' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create a meeting token for this participant
    const tokenRes = await fetch('https://api.daily.co/v1/meeting-tokens', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DAILY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          room_name: room.daily_room_name,
          user_name: participant_name || 'Participant',
          // Token valid for 4 hours
          exp: Math.floor(Date.now() / 1000) + 4 * 60 * 60,
          enable_screenshare: false,
          start_video_off: true,
          start_audio_off: false,
        },
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Daily token creation failed:', errText);
      throw new Error(`Daily token creation failed: ${tokenRes.status}`);
    }

    const { token } = await tokenRes.json();

    // Get the Daily domain for constructing the room URL
    const domainRes = await fetch('https://api.daily.co/v1/', {
      headers: { 'Authorization': `Bearer ${DAILY_API_KEY}` },
    });
    const domainData = await domainRes.json();
    const dailyDomain = domainData.domain_name || 'unknown';

    const roomUrl = `https://${dailyDomain}.daily.co/${room.daily_room_name}`;

    return new Response(
      JSON.stringify({
        token,
        room_url: roomUrl,
        daily_room_name: room.daily_room_name,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
