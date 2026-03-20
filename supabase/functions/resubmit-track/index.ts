import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const token = authHeader.replace('Bearer ', '');
    
    // Verify the user
    let userId: string | null = null;
    if (token && token !== anonKey) {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
      userId = user.id;
    }

    const { recording_id, new_file_url, new_filename, file_size_bytes } = await req.json();

    if (!recording_id || !new_file_url) {
      return new Response(JSON.stringify({ error: 'recording_id and new_file_url are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Fetch current recording
    const { data: rec, error: fetchErr } = await supabase
      .from('voice_recordings')
      .select('id, file_url, metadata, user_id, session_id')
      .eq('id', recording_id)
      .single();

    if (fetchErr || !rec) {
      return new Response(JSON.stringify({ error: 'Recording not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Verify user is participant of this session
    if (userId) {
      const { data: room } = await supabase
        .from('rooms')
        .select('id')
        .eq('session_id', rec.session_id)
        .limit(1)
        .single();

      if (room) {
        const { data: participant } = await supabase
          .from('room_participants')
          .select('id')
          .eq('room_id', room.id)
          .eq('user_id', userId)
          .limit(1)
          .single();

        if (!participant) {
          // Also allow if user owns the recording
          if (rec.user_id !== userId) {
            return new Response(JSON.stringify({ error: 'Not authorized for this session' }), {
              status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        }
      }
    }

    // Save old file_url in metadata history
    const currentMetadata = (rec.metadata as Record<string, unknown>) || {};
    const fileHistory = (currentMetadata.file_url_history as string[]) || [];
    if (rec.file_url) {
      fileHistory.push(rec.file_url);
    }

    const updatedMetadata = {
      ...currentMetadata,
      file_url_history: fileHistory,
      last_resubmitted_at: new Date().toISOString(),
    };

    // Update the recording: new file, reset statuses
    const updateData: Record<string, unknown> = {
      file_url: new_file_url,
      metadata: updatedMetadata,
      quality_status: 'pending',
      validation_status: 'pending',
      quality_rejection_reason: null,
      validation_rejection_reason: null,
      quality_reviewed_at: null,
      quality_reviewed_by: null,
      validation_reviewed_at: null,
      validation_reviewed_by: null,
      snr_db: null,
      status: 'pending',
      updated_at: new Date().toISOString(),
    };

    if (new_filename) updateData.filename = new_filename;
    if (file_size_bytes) updateData.file_size_bytes = file_size_bytes;

    const { error: updateErr } = await supabase
      .from('voice_recordings')
      .update(updateData)
      .eq('id', recording_id);

    if (updateErr) {
      console.error('Update error:', updateErr);
      return new Response(JSON.stringify({ error: 'Failed to update recording', details: updateErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: true, recording_id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
