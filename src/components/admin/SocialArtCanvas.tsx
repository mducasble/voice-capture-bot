import { forwardRef } from "react";
import kgenLogoGreen from "@/assets/kgen-logo-green.png";
import type { Campaign } from "@/lib/campaignTypes";
import { TASK_TYPE_LABELS } from "@/lib/campaignTypes";

interface Props {
  campaign: Campaign | null;
  format: { width: number; height: number; id: string };
  language: string;
  shortLink: string;
}

// Convert ISO 3166-1 alpha-2 code to flag emoji
function countryFlag(code: string): string {
  const upper = code.toUpperCase();
  return String.fromCodePoint(...[...upper].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

const LANG_LABELS: Record<string, Record<string, string>> = {
  pt: {
    earn: "GANHE",
    perHour: "/hora",
    perUnit: "/unid",
    joinNow: "PARTICIPE AGORA",
    quest: "QUEST",
  },
  en: {
    earn: "EARN",
    perHour: "/hour",
    perUnit: "/unit",
    joinNow: "JOIN NOW",
    quest: "QUEST",
  },
  es: {
    earn: "GANA",
    perHour: "/hora",
    perUnit: "/unid",
    joinNow: "PARTICIPA AHORA",
    quest: "QUEST",
  },
};

const SocialArtCanvas = forwardRef<HTMLDivElement, Props>(
  ({ campaign, format, language, shortLink }, ref) => {
    const labels = LANG_LABELS[language] || LANG_LABELS.en;
    const isVertical = format.height > format.width;
    const isWide = format.width > format.height && format.id === "twitter";

    const taskTypes = (campaign?.task_sets || [])
      .filter(ts => ts.enabled)
      .map(ts => TASK_TYPE_LABELS[ts.task_type] || ts.task_type);

    const reward = campaign?.reward_config;
    const rewardText = reward?.base_rate
      ? `${reward.currency || "USD"} ${reward.base_rate}${reward.payout_model === "per_accepted_hour" ? labels.perHour : labels.perUnit}`
      : null;

    // Grid size
    const gridSize = isWide ? 40 : 60;

    // Font sizes scaled to canvas
    const titleSize = isWide ? 48 : isVertical ? 72 : 64;
    const subtitleSize = isWide ? 22 : isVertical ? 32 : 28;
    const bodySize = isWide ? 18 : isVertical ? 24 : 22;
    const linkSize = isWide ? 20 : isVertical ? 28 : 24;
    const rewardSize = isWide ? 56 : isVertical ? 80 : 72;
    const logoSize = isWide ? 96 : isVertical ? 128 : 112;
    const badgeSize = isWide ? 56 : isVertical ? 72 : 64;
    const smallBadgeSize = isWide ? 14 : isVertical ? 18 : 16;

    const padding = isWide ? 48 : 64;

    return (
      <div
        ref={ref}
        style={{
          width: format.width,
          height: format.height,
          backgroundColor: "#111111",
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.18) 2px, transparent 2px),
            linear-gradient(90deg, rgba(255,255,255,0.18) 2px, transparent 2px)
          `,
          backgroundSize: `${gridSize}px ${gridSize}px`,
          position: "relative",
          fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
          color: "#eaeaea",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Corner accents */}
        <div style={{ position: "absolute", top: 20, left: 20, width: 12, height: 12, background: "#8cff05" }} />
        <div style={{ position: "absolute", top: 20, right: 20, width: 12, height: 12, background: "#8cff05" }} />
        <div style={{ position: "absolute", bottom: 20, left: 20, width: 12, height: 12, background: "#8cff05" }} />
        <div style={{ position: "absolute", bottom: 20, right: 20, width: 12, height: 12, background: "#8cff05" }} />

        {/* Top bar: Logo + QUEST badge */}
        <div style={{ padding: `${padding}px ${padding}px 0`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {/* KGeN Logo placeholder - using text since we can't embed SVG easily in export */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img
              src={kgenLogoGreen}
              alt="KGeN"
              style={{
                width: logoSize,
                height: logoSize,
                objectFit: "contain",
              }}
            />
          </div>
          <div style={{
            background: "#8cff05",
            color: "#111",
            padding: `${badgeSize * 0.15}px ${badgeSize * 0.4}px`,
            fontSize: badgeSize,
            fontWeight: 800,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
          }}>
            {labels.quest}
          </div>
        </div>

        {/* Main content area */}
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: isVertical ? "center" : "center",
          padding: `${padding * 0.5}px ${padding}px`,
          gap: isVertical ? 40 : 24,
        }}>
          {/* Campaign name */}
          <div>
            <h1 style={{
              fontSize: titleSize,
              fontWeight: 900,
              lineHeight: 1.05,
              textTransform: "uppercase",
              letterSpacing: "-0.02em",
              margin: 0,
              color: "#fff",
            }}>
              {campaign?.name || "Quest Name"}
            </h1>
          </div>

          {/* Description */}
          {campaign?.description && (
            <p style={{
              fontSize: bodySize,
              lineHeight: 1.5,
              color: "rgba(255,255,255,0.6)",
              margin: 0,
              maxWidth: format.width * 0.8,
            }}>
              {campaign.description.length > 120
                ? campaign.description.slice(0, 120) + "..."
                : campaign.description}
            </p>
          )}

          {/* Reward highlight */}
          {rewardText && (
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <span style={{ fontSize: smallBadgeSize, fontWeight: 600, color: "#8cff05", textTransform: "uppercase", letterSpacing: "0.15em" }}>
                {labels.earn}
              </span>
              <span style={{
                fontSize: rewardSize,
                fontWeight: 900,
                color: "#8cff05",
                lineHeight: 1,
              }}>
                {rewardText}
              </span>
            </div>
          )}

          {/* Task type badges */}
          {taskTypes.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {taskTypes.map((t, i) => (
                <span key={i} style={{
                  border: "1px solid rgba(140, 255, 5, 0.3)",
                  color: "#8cff05",
                  padding: `${smallBadgeSize * 0.4}px ${smallBadgeSize * 0.9}px`,
                  fontSize: smallBadgeSize,
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}>
                  {t}
                </span>
              ))}
            </div>
          )}
          {/* Country flags */}
          {(() => {
            const countries = campaign?.geographic_scope?.countries || [];
            if (countries.length === 0) return null;
            const flagSize = isWide ? 28 : isVertical ? 40 : 36;
            return (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                {countries.map((c, i) => (
                  <span key={i} style={{ fontSize: flagSize, lineHeight: 1 }}>
                    {countryFlag(c)}
                  </span>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Bottom: CTA + link */}
        <div style={{
          padding: `0 ${padding}px ${padding}px`,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}>
          <div style={{
            background: "#8cff05",
            color: "#111",
            padding: `${linkSize * 0.8}px ${linkSize * 1.5}px`,
            fontSize: linkSize * 1.3,
            fontWeight: 900,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            textAlign: "center",
            width: "60%",
            minWidth: "50%",
          }}>
            {labels.joinNow}
          </div>
          <span style={{
            fontSize: linkSize * 0.85,
            fontWeight: 600,
            color: "rgba(255,255,255,0.5)",
            letterSpacing: "0.05em",
          }}>
            {shortLink || "kgen.quest"}
          </span>
      </div>
      </div>
    );
  }
);

SocialArtCanvas.displayName = "SocialArtCanvas";
export default SocialArtCanvas;
