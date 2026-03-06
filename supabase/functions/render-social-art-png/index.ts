const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const LANG_LABELS: Record<string, Record<string, string>> = {
  pt: { earn: "GANHE", perHour: "/hora", perUnit: "/unid", joinNow: "PARTICIPE AGORA", quest: "QUEST" },
  en: { earn: "EARN", perHour: "/hour", perUnit: "/unit", joinNow: "JOIN NOW", quest: "QUEST" },
  es: { earn: "GANA", perHour: "/hora", perUnit: "/unid", joinNow: "PARTICIPA AHORA", quest: "QUEST" },
};

// KGeN logo as inline SVG paths (from Asset_16-2.svg)
const KGEN_LOGO_SVG = `<svg viewBox="0 0 220.04 220.04" xmlns="http://www.w3.org/2000/svg">
  <rect fill="#8cff05" width="220.04" height="220.04"/>
  <rect fill="#1f3338" x="22.59" y="22.59" width="20.07" height="26.1"/>
  <path fill="#1f3338" d="M148.32,54.02v16.05h33.14v16.97h-47.91v-48.4h63.91v-16.05h-62.74c-9.84,0-17.83,7.98-17.83,17.83v44.85c0,9.84,7.98,17.83,17.83,17.83h62.79v-49.08h-49.2Z"/>
  <path fill="#1f3338" d="M22.54,134.69v44.85c0,9.84,7.98,17.83,17.83,17.83h62.74v-16.05h-63.91v-48.4h46.1v16.97h-31.33v16.05h49.2v-49.08h-62.79c-9.84,0-17.83,7.98-17.83,17.83Z"/>
  <rect fill="#1f3338" x="22.59" y="76.99" width="20.07" height="26.1"/>
  <rect fill="#1f3338" x="116.9" y="165.94" width="20.07" height="31.42"/>
  <rect fill="#1f3338" x="177.45" y="116.86" width="20.07" height="31.42"/>
  <polygon fill="#1f3338" points="43.83 62.84 89.52 103.11 103.16 103.11 103.16 89.47 72.91 62.84 103.16 36.21 103.16 22.59 89.52 22.58 43.83 62.84"/>
  <polygon fill="#1f3338" points="116.93 116.86 116.93 131.1 183.2 197.38 197.45 197.38 197.45 183.14 131.17 116.86 116.93 116.86"/>
</svg>`;

// Fetch image and convert to base64 data URI
async function fetchAsBase64(url: string): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) return "";
    const buf = await res.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    const ct = res.headers.get("content-type") || "image/png";
    return `data:${ct};base64,${b64}`;
  } catch {
    return "";
  }
}

// SVG-escaped text
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Word-wrap text into lines of maxChars
function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if (current.length + w.length + 1 > maxChars && current.length > 0) {
      lines.push(current);
      current = w;
    } else {
      current = current ? current + " " + w : w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      campaignName = "Quest Name",
      campaignDescription = "",
      taskTypes = [],
      reward,
      language = "pt",
      format = { width: 1080, height: 1080, id: "instagram-post" },
      shortLink = "kgen.quest",
      countries = [],
      customTitle,
      customDescription,
    } = body;

    const w = format.width;
    const h = format.height;
    const labels = LANG_LABELS[language] || LANG_LABELS.en;
    const isVertical = h > w;
    const isWide = w > h && format.id === "twitter";

    // Font sizes
    const titleSize = isWide ? 51 : isVertical ? 75 : 67;
    const bodySize = isWide ? 28 : isVertical ? 36 : 32;
    const linkSize = isWide ? 23 : isVertical ? 31 : 27;
    const rewardSize = isWide ? 59 : isVertical ? 83 : 75;
    const badgeSize = isWide ? 56 : isVertical ? 72 : 64;
    const smallBadgeSize = isWide ? 14 : isVertical ? 18 : 16;
    const taskTypeSize = smallBadgeSize * 2.5;
    const earnSize = smallBadgeSize * 3;
    const padding = isWide ? 48 : 64;
    const gridSize = isWide ? 40 : 60;
    const logoSize = isWide ? 96 : isVertical ? 128 : 112;
    const flagH = isWide ? 28 : isVertical ? 40 : 36;

    // Reward text
    const rewardText = reward?.base_rate
      ? `${reward.currency || "USD"} ${reward.base_rate}${reward.payout_model === "per_accepted_hour" ? labels.perHour : labels.perUnit}`
      : null;

    const title = esc(customTitle || campaignName);
    const desc = customDescription || campaignDescription || "";
    const truncDesc = desc.length > 120 ? desc.slice(0, 120) + "..." : desc;

    // Fetch logo
    const logoUrl = "https://voice-tracker.lovable.app/assets/kgen-logo-green.png";
    const logoB64 = await fetchAsBase64(logoUrl);

    // Fetch flag images
    const flagImages: string[] = [];
    for (const c of countries) {
      const b64 = await fetchAsBase64(`https://flagcdn.com/w80/${c.toLowerCase()}.png`);
      if (b64) flagImages.push(b64);
    }

    // Build SVG
    const parts: string[] = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);

    // Background
    parts.push(`<rect width="${w}" height="${h}" fill="#111111"/>`);

    // Grid
    parts.push(`<defs><pattern id="grid" width="${gridSize}" height="${gridSize}" patternUnits="userSpaceOnUse">`);
    parts.push(`<path d="M ${gridSize} 0 L 0 0 0 ${gridSize}" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="2"/>`);
    parts.push(`</pattern></defs>`);
    parts.push(`<rect width="${w}" height="${h}" fill="url(#grid)"/>`);

    // Corner accents
    const accentSize = 12;
    parts.push(`<rect x="20" y="20" width="${accentSize}" height="${accentSize}" fill="#8cff05"/>`);
    parts.push(`<rect x="${w - 32}" y="20" width="${accentSize}" height="${accentSize}" fill="#8cff05"/>`);
    parts.push(`<rect x="20" y="${h - 32}" width="${accentSize}" height="${accentSize}" fill="#8cff05"/>`);
    parts.push(`<rect x="${w - 32}" y="${h - 32}" width="${accentSize}" height="${accentSize}" fill="#8cff05"/>`);

    // Font style
    const fontFamily = `'SF Mono', 'Fira Code', 'Consolas', 'Courier New', monospace`;

    // Logo
    if (logoB64) {
      parts.push(`<image href="${logoB64}" x="${padding}" y="${padding}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet"/>`);
    }

    // QUEST badge
    const questText = labels.quest;
    const questW = badgeSize * questText.length * 0.7 + badgeSize * 0.8;
    const questH = badgeSize * 1.3;
    const questX = w - padding - questW;
    const questY = padding;
    parts.push(`<rect x="${questX}" y="${questY}" width="${questW}" height="${questH}" fill="#8cff05"/>`);
    parts.push(`<text x="${questX + questW / 2}" y="${questY + questH * 0.72}" text-anchor="middle" font-family="${fontFamily}" font-size="${badgeSize}" font-weight="800" letter-spacing="0.2em" fill="#111">${questText}</text>`);

    // Content area
    let cy = padding + logoSize + padding * 0.8;

    // Task type labels
    if (taskTypes.length > 0) {
      const taskLabel = esc(taskTypes.join(" · "));
      parts.push(`<text x="${padding}" y="${cy}" font-family="${fontFamily}" font-size="${taskTypeSize}" font-weight="800" letter-spacing="0.03em" fill="#8cff05" text-transform="uppercase">${taskLabel}</text>`);
      cy += taskTypeSize + 20;
    }

    // Title (word-wrapped)
    const titleMaxChars = isWide ? 30 : isVertical ? 18 : 20;
    const titleLines = wrapText(title, titleMaxChars);
    for (const line of titleLines) {
      parts.push(`<text x="${padding}" y="${cy}" font-family="${fontFamily}" font-size="${titleSize}" font-weight="900" letter-spacing="-0.02em" fill="#ffffff" text-transform="uppercase">${esc(line)}</text>`);
      cy += titleSize * 1.1;
    }
    cy += 10;

    // Description (word-wrapped)
    if (truncDesc) {
      const descMaxChars = isWide ? 50 : isVertical ? 30 : 35;
      const descLines = wrapText(truncDesc, descMaxChars);
      for (const line of descLines) {
        parts.push(`<text x="${padding}" y="${cy}" font-family="${fontFamily}" font-size="${bodySize}" font-weight="400" fill="rgba(255,255,255,0.85)">${esc(line)}</text>`);
        cy += bodySize * 1.5;
      }
    }

    // Bottom section: Reward + Flags + CTA + Link
    // Calculate from bottom up
    const linkY = h - padding;
    const ctaH = linkSize * 2.6;
    const ctaY = linkY - linkSize * 1.2 - ctaH;
    const flagsY = ctaY - 18 - flagH;
    const rewardH = rewardSize * 1.6;
    const rewardY = flagImages.length > 0 ? flagsY - 18 - rewardH : ctaY - 18 - rewardH;

    // Reward block
    if (rewardText) {
      const earnW = earnSize * labels.earn.length * 0.65;
      const rewardTextW = rewardSize * rewardText.length * 0.62;
      const blockW = earnW + rewardTextW + 40;
      const blockH = rewardH;
      const blockX = padding;
      const blockY2 = rewardY;

      parts.push(`<rect x="${blockX}" y="${blockY2}" width="${blockW}" height="${blockH}" fill="#8cff05"/>`);
      parts.push(`<text x="${blockX + 16}" y="${blockY2 + blockH * 0.65}" font-family="${fontFamily}" font-size="${earnSize}" font-weight="800" letter-spacing="0.1em" fill="#111">${labels.earn}</text>`);
      parts.push(`<text x="${blockX + earnW + 24}" y="${blockY2 + blockH * 0.72}" font-family="${fontFamily}" font-size="${rewardSize}" font-weight="900" fill="#111">${esc(rewardText)}</text>`);
    }

    // Flags
    if (flagImages.length > 0) {
      let fx = padding;
      for (const flagB64 of flagImages) {
        const flagW = flagH * 1.5;
        parts.push(`<image href="${flagB64}" x="${fx}" y="${flagsY}" width="${flagW}" height="${flagH}" preserveAspectRatio="xMidYMid meet"/>`);
        fx += flagW + 10;
      }
    }

    // CTA button
    const ctaText = labels.joinNow;
    const ctaW = w * 0.55;
    parts.push(`<rect x="${padding}" y="${ctaY}" width="${ctaW}" height="${ctaH}" fill="#8cff05"/>`);
    parts.push(`<text x="${padding + ctaW / 2}" y="${ctaY + ctaH * 0.65}" text-anchor="middle" font-family="${fontFamily}" font-size="${linkSize * 1.3}" font-weight="900" letter-spacing="0.12em" fill="#111">${esc(ctaText)}</text>`);

    // Short link
    parts.push(`<text x="${padding}" y="${linkY}" font-family="${fontFamily}" font-size="${linkSize * 0.85}" font-weight="600" fill="rgba(255,255,255,0.5)" letter-spacing="0.05em">${esc(shortLink)}</text>`);

    parts.push(`</svg>`);

    const svg = parts.join("\n");

    return new Response(JSON.stringify({ svg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("render-social-art-png error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
