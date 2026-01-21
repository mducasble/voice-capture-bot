import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-bot-api-key',
};

// Generate AWS4-HMAC-SHA256 signature for S3-compatible API
async function signRequest(
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
  
  // Canonical request components
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
    '', // query string (empty for PUT)
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  
  // String to sign
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalRequestHash = await sha256Hex(canonicalRequest);
  
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    canonicalRequestHash
  ].join('\n');
  
  // Calculate signature
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
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate bot API key
    const botApiKey = req.headers.get('x-bot-api-key');
    const expectedApiKey = Deno.env.get('BOT_API_KEY');
    
    if (!botApiKey || botApiKey !== expectedApiKey) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get B2 credentials
    const keyId = Deno.env.get('B2_KEY_ID');
    const applicationKey = Deno.env.get('B2_APPLICATION_KEY');
    const bucketName = Deno.env.get('B2_BUCKET_NAME');
    const bucketEndpoint = Deno.env.get('B2_BUCKET_ENDPOINT');

    if (!keyId || !applicationKey || !bucketName || !bucketEndpoint) {
      return new Response(
        JSON.stringify({ error: 'B2 credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { filename, content_type = 'audio/wav' } = body;

    if (!filename) {
      return new Response(
        JSON.stringify({ error: 'filename is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

     // Normalize endpoint -> host only (users sometimes include protocol and/or bucket path)
     const endpointUrl = new URL(
       bucketEndpoint.startsWith('http') ? bucketEndpoint : `https://${bucketEndpoint}`
     );
     const host = endpointUrl.host;

     // Extract region from endpoint host (e.g., s3.us-west-004.backblazeb2.com -> us-west-004)
     const regionMatch = host.match(/s3\.([^.]+)\.backblazeb2\.com/);
     const region = regionMatch ? regionMatch[1] : 'us-west-004';

     if (endpointUrl.pathname && endpointUrl.pathname !== '/' && endpointUrl.pathname !== '') {
       console.warn(
         'B2_BUCKET_ENDPOINT contains a path; ignoring pathname and using only host:',
         endpointUrl.pathname
       );
     }

    const path = `/${bucketName}/${filename}`;
    
     console.log('Generating signed URL for B2:', {
       host,
       region,
       bucketName,
       path,
     });
    
    const { headers, url } = await signRequest(
      'PUT',
      path,
      host,
      region,
      keyId,
      applicationKey,
      content_type
    );

    // Public URL for reading
    const publicUrl = `https://${host}/${bucketName}/${filename}`;

    return new Response(
      JSON.stringify({ 
        upload_url: url,
        headers,
        public_url: publicUrl,
        storage: 'b2'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('B2 upload error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
