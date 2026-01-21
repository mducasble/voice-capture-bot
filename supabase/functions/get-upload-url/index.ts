import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-bot-api-key',
};

// Generate AWS4-HMAC-SHA256 signature for S3
async function signS3Request(
  method: string,
  path: string,
  host: string,
  region: string,
  accessKeyId: string,
  secretAccessKey: string,
  contentType: string
): Promise<{ headers: Record<string, string>; url: string }> {
  const encoder = new TextEncoder();
  
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);
  const service = 's3';
  
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const payloadHash = 'UNSIGNED-PAYLOAD';
  
  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    ''
  ].join('\n');
  
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalRequestHash = await sha256Hex(canonicalRequest);
  
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    canonicalRequestHash
  ].join('\n');
  
  const kDate = await hmacSha256(encoder.encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = await hmacSha256Hex(kSigning, stringToSign);
  
  const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  
  return {
    headers: {
      'Authorization': authorizationHeader,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      'Content-Type': contentType
    },
    url: `https://${host}${path}`
  };
}

async function sha256Hex(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256(key: Uint8Array | ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
}

async function hmacSha256Hex(key: Uint8Array | ArrayBuffer, message: string): Promise<string> {
  const result = await hmacSha256(key, message);
  return Array.from(new Uint8Array(result))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

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
    const { filename, content_type = 'audio/wav' } = await req.json();

    if (!filename) {
      return new Response(
        JSON.stringify({ error: 'filename is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Generating signed upload URL for: ${filename}`);

    // Get AWS credentials
    const accessKeyId = Deno.env.get('AWS_ACCESS_KEY_ID');
    const secretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY');
    const bucketName = Deno.env.get('AWS_S3_BUCKET_NAME');
    const region = Deno.env.get('AWS_S3_REGION') || 'us-east-1';

    if (!accessKeyId || !secretAccessKey || !bucketName) {
      console.error('AWS credentials not configured');
      return new Response(
        JSON.stringify({ error: 'AWS credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const host = `${bucketName}.s3.${region}.amazonaws.com`;
    const path = `/${filename}`;
    
    console.log('Generating signed URL for S3:', { host, region, bucketName, path });
    
    const { headers, url } = await signS3Request(
      'PUT',
      path,
      host,
      region,
      accessKeyId,
      secretAccessKey,
      content_type
    );

    // Public URL (if bucket is public)
    const publicUrl = `https://${host}/${filename}`;

    console.log(`Signed URL generated successfully for: ${filename}`);

    return new Response(
      JSON.stringify({
        signed_url: url,
        upload_headers: headers,
        public_url: publicUrl,
        storage: 's3'
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
