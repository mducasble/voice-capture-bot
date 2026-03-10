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

    // Extract user_id from JWT if present
    let authUserId: string | null = null;
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) authUserId = user.id;
    }

    // Parse multipart form data (binary audio + metadata)
    const formData = await req.formData();
    const audioFile = formData.get('audio') as File | null;
    const filename = formData.get('filename') as string;
    const session_id = formData.get('session_id') as string;
    const participant_id = formData.get('participant_id') as string;
    const participant_name = formData.get('participant_name') as string;
    const recording_type = (formData.get('recording_type') as string) || 'individual';
    const format = (formData.get('format') as string) || 'wav';
    const noise_gate_enabled = (formData.get('noise_gate_enabled') as string) === 'true';
    const campaign_id = formData.get('campaign_id') as string | null;

    if (!audioFile || !filename || !session_id || !campaign_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields (audio, filename, session_id, campaign_id)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Uploading room recording: ${filename} for participant ${participant_name} (${audioFile.size} bytes)`);

    // Read audio file as bytes
    const bytes = new Uint8Array(await audioFile.arrayBuffer());

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
    const contentType = format === 'wav' ? 'audio/wav' : 'audio/webm';
    
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

    // Calculate duration from WAV file size (PCM: size = duration * sampleRate * channels * bytesPerSample + 44 header)
    const wavChannels = format === 'wav' ? 1 : 2;
    const bytesPerSample = 2; // 16-bit
    const sampleRate = 48000;
    const headerSize = 44;
    const pcmBytes = Math.max(0, bytes.length - headerSize);
    const durationSeconds = pcmBytes / (sampleRate * wavChannels * bytesPerSample);

    console.log(`Calculated duration: ${durationSeconds.toFixed(2)}s from ${bytes.length} bytes`);

    // Check for duplicate: if an individual recording for this participant+session already exists, skip
    if (recording_type === 'individual') {
      const { data: existing } = await supabase
        .from('voice_recordings')
        .select('id')
        .eq('discord_channel_id', session_id)
        .eq('discord_user_id', participant_id)
        .eq('recording_type', 'individual')
        .limit(1);
      
      if (existing && existing.length > 0) {
        console.log(`Individual recording already exists for participant ${participant_id} in session ${session_id}, skipping duplicate`);
        return new Response(
          JSON.stringify({ 
            success: true, 
            recording_id: existing[0].id,
            file_url: s3Url,
            skipped_duplicate: true,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Register in database
    const { data: recordData, error: recordError } = await supabase
      .from('voice_recordings')
      .insert({
        discord_guild_id: 'webapp',
        discord_channel_id: session_id,
        discord_user_id: participant_id,
        discord_username: participant_name,
        user_id: authUserId,
        filename,
        file_url: s3Url,
        file_size_bytes: bytes.length,
        duration_seconds: durationSeconds > 0 ? durationSeconds : null,
        sample_rate: sampleRate,
        bit_depth: 16,
        channels: wavChannels,
        format,
        status: format === 'wav' ? 'processing' : 'completed',
        session_id,
        recording_type,
        campaign_id: campaign_id || null,
        transcription_status: 'pending',
        language: 'pt',
        metadata: { source: 'webapp', participant_id, campaign_id: campaign_id || undefined },
      })
      .select()
      .single();

    if (recordError) {
      console.error('Database insert error:', recordError);
      throw recordError;
    }

    console.log(`Recording registered: ${recordData.id}`);

    // Trigger processing for WAV files (compatible with process-audio)
    if (format === 'wav') {
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
          noise_gate_enabled,
        }),
      }).catch(err => console.error('Failed to trigger processing:', err));
      
      console.log(`Triggered process-audio for WAV recording: ${recordData.id}`);
    }

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
