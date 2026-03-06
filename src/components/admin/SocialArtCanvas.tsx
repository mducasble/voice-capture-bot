import { forwardRef } from "react";
import kgenLogoGreen from "@/assets/kgen-logo-green.png";
import type { Campaign } from "@/lib/campaignTypes";
import { TASK_TYPE_LABELS } from "@/lib/campaignTypes";

interface Props {
  campaign: Campaign | null;
  format: { width: number; height: number; id: string };
  language: string;
  shortLink: string;
  customTitle?: string;
  customDescription?: string;
  extraCountries?: string[];
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
  ({ campaign, format, language, shortLink, customTitle, customDescription, extraCountries }, ref) => {
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
    const titleSize = isWide ? 51 : isVertical ? 75 : 67;
    const subtitleSize = isWide ? 25 : isVertical ? 35 : 31;
    const bodySize = isWide ? 28 : isVertical ? 36 : 32;
    const linkSize = isWide ? 23 : isVertical ? 31 : 27;
    const rewardSize = isWide ? 59 : isVertical ? 83 : 75;
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
          position: "relative",
          fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
          color: "#eaeaea",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Grid overlay */}
        <div style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: format.width,
          height: format.height,
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.05) 2px, transparent 2px),
            linear-gradient(90deg, rgba(255,255,255,0.05) 2px, transparent 2px)
          `,
          backgroundSize: `${gridSize}px ${gridSize}px`,
          pointerEvents: "none",
          zIndex: 0,
        }} />

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
          {/* Task type labels - above title */}
          {taskTypes.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {taskTypes.map((t, i) => (
                <span key={i} style={{
                  color: "#8cff05",
                  fontSize: smallBadgeSize * 3,
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  lineHeight: 1.1,
                }}>
                  {t}
                </span>
              ))}
            </div>
          )}

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
              {customTitle || campaign?.name || "Quest Name"}
            </h1>
          </div>

          {/* Description */}
          {(customDescription || campaign?.description) && (
            <p style={{
              fontSize: bodySize,
              lineHeight: 1.5,
              color: "rgba(255,255,255,0.85)",
              margin: 0,
              maxWidth: format.width * 0.8,
            }}>
              {(() => {
                const desc = customDescription || campaign?.description || "";
                return desc.length > 120 ? desc.slice(0, 120) + "..." : desc;
              })()}
            </p>
          )}

          {/* Reward highlight - green background */}
          {rewardText && (
            <div style={{
              display: "inline-flex",
              alignItems: "baseline",
              gap: 16,
              background: "#8cff05",
              padding: `${rewardSize * 0.3}px ${rewardSize * 0.5}px`,
              alignSelf: "flex-start",
            }}>
              <span style={{
                fontSize: smallBadgeSize * 3,
                fontWeight: 800,
                color: "#111",
                textTransform: "uppercase",
                letterSpacing: "0.15em",
              }}>
                {labels.earn}
              </span>
              <span style={{
                fontSize: rewardSize,
                fontWeight: 900,
                color: "#111",
                lineHeight: 1,
              }}>
                {rewardText}
              </span>
            </div>
          )}

          {/* Country codes */}
          {(() => {
            const campaignCountries = campaign?.geographic_scope?.countries || [];
            const extra = extraCountries || [];
            const allCountries = [...new Set([...campaignCountries, ...extra])];
            if (allCountries.length === 0) return null;
            const codeFontSize = isWide ? 24 : isVertical ? 32 : 28;
            return (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 4 }}>
                {allCountries.map((c, i) => (
                  <span key={i} style={{
                    fontSize: codeFontSize,
                    fontWeight: 700,
                    color: "rgba(255,255,255,0.5)",
                    letterSpacing: "0.1em",
                    border: "1px solid rgba(255,255,255,0.2)",
                    padding: "4px 10px",
                  }}>
                    {c.toUpperCase()}
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
