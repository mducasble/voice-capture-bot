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
    // Auth: either BOT_API_KEY or valid JWT
    const botApiKey = req.headers.get('x-bot-api-key');
    const expectedApiKey = Deno.env.get('BOT_API_KEY');
    const authHeader = req.headers.get('authorization');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    let authUserId: string | null = null;

    if (botApiKey && botApiKey === expectedApiKey) {
      // Bot/Electron auth — OK
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

    const body = await req.json();
    const {
      creator_name,
      room_name,
      campaign_id,
      user_id,        // for bot/electron: the user_id to associate
      topic,
      participants,   // optional: array of { name, user_id? } to pre-register
    } = body;

    if (!creator_name) {
      return new Response(
        JSON.stringify({ error: 'creator_name is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Resolve user_id: from JWT or from body (bot/electron)
    const resolvedUserId = authUserId || user_id || null;

    // 1. Create the room
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .insert({
        creator_name: creator_name.trim(),
        room_name: room_name?.trim() || `Sala de ${creator_name.trim()}`,
        status: 'waiting',
        topic: topic || null,
      })
      .select()
      .single();

    if (roomError) {
      console.error('Room creation error:', roomError);
      return new Response(
        JSON.stringify({ error: 'Failed to create room', details: roomError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Add creator as first participant
    const { data: creatorParticipant, error: partError } = await supabase
      .from('room_participants')
      .insert({
        room_id: room.id,
        name: creator_name.trim(),
        is_creator: true,
        user_id: resolvedUserId,
      })
      .select()
      .single();

    if (partError) {
      console.error('Participant creation error:', partError);
    }

    // 3. Pre-register additional participants if provided
    const registeredParticipants = [];
    if (participants && Array.isArray(participants)) {
      for (const p of participants) {
        const { data: pData } = await supabase
          .from('room_participants')
          .insert({
            room_id: room.id,
            name: p.name,
            is_creator: false,
            user_id: p.user_id || null,
          })
          .select()
          .single();
        if (pData) registeredParticipants.push(pData);
      }
    }

    // 4. Build room URL with campaign
    let room_url = `/room/${room.id}`;
    if (campaign_id) {
      room_url += `?campaign=${campaign_id}`;
    }

    // If user has a referral code, append it
    if (resolvedUserId) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('referral_code')
        .eq('id', resolvedUserId)
        .single();
      if (profile?.referral_code) {
        room_url += (room_url.includes('?') ? '&' : '?') + `ref=${profile.referral_code}`;
      }
    }

    console.log(`Room created: ${room.id} by ${creator_name}`);

    return new Response(
      JSON.stringify({
        success: true,
        room: {
          id: room.id,
          session_id: room.session_id,
          room_name: room.room_name,
          status: room.status,
          created_at: room.created_at,
        },
        creator_participant: creatorParticipant ? {
          id: creatorParticipant.id,
          name: creatorParticipant.name,
        } : null,
        additional_participants: registeredParticipants.map(p => ({
          id: p.id,
          name: p.name,
        })),
        room_url,
        // Upload instructions for the Electron app
        upload_endpoints: {
          stream_upload: '/functions/v1/stream-upload-to-s3',
          register_recording: '/functions/v1/register-room-recording',
        },
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
