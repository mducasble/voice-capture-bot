import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-bot-api-key',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate bot API key
    const botApiKey = req.headers.get('x-bot-api-key');
    const expectedBotApiKey = Deno.env.get('BOT_API_KEY');
    
    if (!botApiKey || botApiKey !== expectedBotApiKey) {
      console.error('Invalid or missing bot API key');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get request body
    const { filename, content_type } = await req.json();

    if (!filename) {
      return new Response(
        JSON.stringify({ error: 'filename is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Generating signed upload URL for: ${filename}`);

    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Generate signed upload URL (valid for 1 hour)
    const { data, error } = await supabase.storage
      .from('voice-recordings')
      .createSignedUploadUrl(filename);

    if (error) {
      console.error('Error creating signed URL:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to create upload URL', details: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Also generate the public URL for after upload
    const { data: publicUrlData } = supabase.storage
      .from('voice-recordings')
      .getPublicUrl(filename);

    console.log(`Signed URL generated successfully for: ${filename}`);

    return new Response(
      JSON.stringify({
        signed_url: data.signedUrl,
        token: data.token,
        path: data.path,
        public_url: publicUrlData.publicUrl
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in get-upload-url function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
