import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const {
      filename,
      audio_base64,
      session_id,
      participant_id,
      participant_name,
      recording_type = 'individual',
    } = await req.json();

    if (!audio_base64 || !filename || !session_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Uploading room recording: ${filename} for participant ${participant_name}`);

    // Decode base64 to binary
    const binaryString = atob(audio_base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Upload to S3
    const s3Bucket = Deno.env.get('AWS_S3_BUCKET_NAME');
    const s3Region = Deno.env.get('AWS_S3_REGION') || 'us-east-1';
    const accessKeyId = Deno.env.get('AWS_ACCESS_KEY_ID');
    const secretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY');

    if (!s3Bucket || !accessKeyId || !secretAccessKey) {
      throw new Error('S3 configuration missing');
    }

    const s3Key = `rooms/${session_id}/${filename}`;
    const s3Url = `https://${s3Bucket}.s3.${s3Region}.amazonaws.com/${s3Key}`;

    // Create signature for S3 PUT
    const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const datestamp = timestamp.slice(0, 8);
    
    const host = `${s3Bucket}.s3.${s3Region}.amazonaws.com`;
    const contentType = 'audio/webm';
    
    // Calculate content hash
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    const payloadHash = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Create canonical request
    const method = 'PUT';
    const canonicalUri = `/${s3Key}`;
    const canonicalQueryString = '';
    const canonicalHeaders = 
      `content-type:${contentType}\n` +
      `host:${host}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${timestamp}\n`;
    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
    
    const canonicalRequest = 
      `${method}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    // Create string to sign
    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${datestamp}/${s3Region}/s3/aws4_request`;
    const canonicalRequestHash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(canonicalRequest)))
    ).map(b => b.toString(16).padStart(2, '0')).join('');
    
    const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${canonicalRequestHash}`;

    // Calculate signature
    const getSignatureKey = async (key: string, dateStamp: string, regionName: string, serviceName: string) => {
      const kDate = await crypto.subtle.sign(
        'HMAC',
        await crypto.subtle.importKey('raw', encoder.encode('AWS4' + key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
        encoder.encode(dateStamp)
      );
      const kRegion = await crypto.subtle.sign(
        'HMAC',
        await crypto.subtle.importKey('raw', new Uint8Array(kDate), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
        encoder.encode(regionName)
      );
      const kService = await crypto.subtle.sign(
        'HMAC',
        await crypto.subtle.importKey('raw', new Uint8Array(kRegion), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
        encoder.encode(serviceName)
      );
      const kSigning = await crypto.subtle.sign(
        'HMAC',
        await crypto.subtle.importKey('raw', new Uint8Array(kService), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
        encoder.encode('aws4_request')
      );
      return kSigning;
    };

    const signingKey = await getSignatureKey(secretAccessKey, datestamp, s3Region, 's3');
    const signature = Array.from(
      new Uint8Array(
        await crypto.subtle.sign(
          'HMAC',
          await crypto.subtle.importKey('raw', new Uint8Array(signingKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
          encoder.encode(stringToSign)
        )
      )
    ).map(b => b.toString(16).padStart(2, '0')).join('');

    const authorizationHeader = 
      `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    // Upload to S3
    const s3Response = await fetch(s3Url, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': timestamp,
        'Authorization': authorizationHeader,
      },
      body: bytes,
    });

    if (!s3Response.ok) {
      const errorText = await s3Response.text();
      console.error('S3 upload failed:', errorText);
      throw new Error(`S3 upload failed: ${s3Response.status}`);
    }

    console.log(`Successfully uploaded to S3: ${s3Url}`);

    // Register in database
    const { data: recordData, error: recordError } = await supabase
      .from('voice_recordings')
      .insert({
        discord_guild_id: 'webapp',
        discord_channel_id: session_id,
        discord_user_id: participant_id,
        discord_username: participant_name,
        filename,
        file_url: s3Url,
        file_size_bytes: bytes.length,
        sample_rate: 48000,
        bit_depth: 16,
        channels: 2,
        format: 'webm',
        status: 'completed',
        session_id,
        recording_type,
        transcription_status: 'pending',
        language: 'pt',
        metadata: { source: 'webapp', participant_id },
      })
      .select()
      .single();

    if (recordError) {
      console.error('Database insert error:', recordError);
      throw recordError;
    }

    console.log(`Recording registered: ${recordData.id}`);

    // Trigger processing
    const processUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/process-audio`;
    
    fetch(processUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({
        recording_id: recordData.id,
        audio_url: s3Url,
      }),
    }).catch(err => console.error('Failed to trigger processing:', err));

    return new Response(
      JSON.stringify({ 
        success: true, 
        recording_id: recordData.id,
        file_url: s3Url,
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
