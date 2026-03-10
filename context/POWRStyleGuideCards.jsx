import { useState } from "react";

// ─────────────────────────────────────────
// POWR DESIGN TOKENS — single source of truth
// ─────────────────────────────────────────
const T = {
  // Core colours
  yellow: "#FFD600",   // POWR Yellow — primary accent
  yellowDim: "#FFD60022", // Yellow tint for backgrounds
  yellowMid: "#FFD60044", // Yellow tint for borders
  black: "#080808",   // True background
  surface1: "#111111",   // Card surface
  surface2: "#1A1A1A",   // Elevated surface / image zone
  surface3: "#222222",   // Dividers, borders
  white: "#FFFFFF",   // Primary text
  grey1: "#888888",   // Secondary text
  grey2: "#555555",   // Tertiary text
  grey3: "#333333",   // Disabled / placeholder

  // Category accent colours
  catFashion: "#7C3AED",
  catGear: "#0EA5E9",
  catNutrition: "#F59E0B",
  catGym: "#EF4444",

  // Typography
  fontDisplay: "'Arial Black', 'Impact', sans-serif",
  fontBody: "'Helvetica Neue', Arial, sans-serif",
  fontMono: "'Courier New', monospace",

  // Radii
  radiusSm: "6px",
  radiusMd: "12px",
  radiusLg: "16px",

  // Spacing scale (px)
  sp1: "4px",
  sp2: "8px",
  sp3: "12px",
  sp4: "16px",
  sp5: "24px",
  sp6: "32px",
  sp7: "48px",
};

// ─────────────────────────────────────────
// STYLE GUIDE SECTIONS
// ─────────────────────────────────────────

function SectionLabel({ children }) {
  return (
    <div style={{
      color: T.grey2, fontSize: "9px", fontWeight: "700",
      letterSpacing: "2.5px", marginBottom: "16px",
      fontFamily: T.fontMono, textTransform: "uppercase",
      display: "flex", alignItems: "center", gap: "10px",
    }}>
      {children}
      <div style={{ flex: 1, height: "1px", background: T.surface3 }} />
    </div>
  );
}

function ColourSwatch({ hex, name, desc, large }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(hex);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div onClick={copy} style={{ cursor: "pointer", userSelect: "none" }}>
      <div style={{
        width: large ? "120px" : "80px",
        height: large ? "80px" : "56px",
        background: hex,
        borderRadius: T.radiusMd,
        border: `1px solid ${hex === T.black ? T.surface3 : "transparent"}`,
        marginBottom: "8px",
        transition: "transform 0.15s",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {copied && <span style={{ fontSize: "16px" }}>✓</span>}
      </div>
      <div style={{ color: T.white, fontSize: "11px", fontWeight: "700", fontFamily: T.fontBody }}>{name}</div>
      <div style={{ color: T.grey2, fontSize: "10px", fontFamily: T.fontMono, marginTop: "2px" }}>{hex}</div>
      {desc && <div style={{ color: T.grey3, fontSize: "9px", marginTop: "2px", maxWidth: "100px" }}>{desc}</div>}
    </div>
  );
}

function TypeSample({ label, style, children }) {
  return (
    <div style={{ marginBottom: "20px" }}>
      <div style={{ color: T.grey2, fontSize: "9px", fontFamily: T.fontMono, marginBottom: "6px", letterSpacing: "1.5px" }}>{label}</div>
      <div style={style}>{children}</div>
    </div>
  );
}

function Token({ name, value }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1000); }}
      style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "8px 12px", background: T.surface2, borderRadius: T.radiusSm,
        cursor: "pointer", border: `1px solid ${T.surface3}`,
        transition: "border-color 0.15s",
        gap: "12px",
      }}
    >
      <span style={{ color: T.grey1, fontSize: "10px", fontFamily: T.fontMono }}>{name}</span>
      <span style={{ color: copied ? T.yellow : T.white, fontSize: "11px", fontFamily: T.fontMono, fontWeight: "700" }}>
        {copied ? "copied!" : value}
      </span>
    </div>
  );
}

function Badge({ children, variant = "default" }) {
  const styles = {
    default: { bg: T.surface2, border: T.surface3, text: T.grey1 },
    yellow: { bg: T.yellowDim, border: T.yellowMid, text: T.yellow },
    fashion: { bg: "#7C3AED22", border: "#7C3AED44", text: "#7C3AED" },
    gear: { bg: "#0EA5E922", border: "#0EA5E944", text: "#0EA5E9" },
    nutrition: { bg: "#F59E0B22", border: "#F59E0B44", text: "#F59E0B" },
  };
  const s = styles[variant];
  return (
    <span style={{
      background: s.bg, border: `1px solid ${s.border}`, color: s.text,
      fontSize: "9px", fontWeight: "700", letterSpacing: "1.5px",
      padding: "3px 9px", borderRadius: T.radiusSm, fontFamily: T.fontMono,
    }}>
      {children}
    </span>
  );
}

// ─────────────────────────────────────────
// UPDATED REWARD CARD
// ─────────────────────────────────────────

const cards = [
  { id: 1, partner: "NOTTO", partnerType: "SPORTSWEAR", reward: "25% Off", detail: "Entire Store", points: 1000, category: "FASHION", distance: "0.3 mi", emoji: "🛍️" },
  { id: 2, partner: "STRIDE", partnerType: "FOOTWEAR", reward: "1/3 Off", detail: "All Trainers", points: 2500, category: "GEAR", distance: "0.7 mi", emoji: "👟" },
  { id: 3, partner: "BULK", partnerType: "NUTRITION", reward: "Free Bundle", detail: "Protein Pack", points: 5000, category: "NUTRITION", distance: "1.2 mi", emoji: "💪" },
];

const catColor = { FASHION: T.catFashion, GEAR: T.catGear, NUTRITION: T.catNutrition };

function RewardCard({ card, compact }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: T.surface1,
        border: `1px solid ${hovered ? T.yellow : T.surface3}`,
        borderRadius: T.radiusLg,
        overflow: "hidden",
        width: compact ? "220px" : "260px",
        cursor: "pointer",
        transition: "all 0.22s ease",
        transform: hovered ? "translateY(-5px)" : "translateY(0)",
        boxShadow: hovered ? `0 20px 50px ${T.yellowDim}` : "0 4px 20px rgba(0,0,0,0.5)",
        flexShrink: 0,
      }}
    >
      {/* Image zone */}
      <div style={{
        background: T.surface2,
        height: compact ? "110px" : "130px",
        position: "relative",
        display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: "linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }} />
        <div style={{ fontSize: compact ? "40px" : "48px", zIndex: 1 }}>{card.emoji}</div>

        {/* Category badge */}
        <div style={{
          position: "absolute", top: "10px", left: "10px",
          background: catColor[card.category] + "22",
          border: `1px solid ${catColor[card.category]}44`,
          color: catColor[card.category],
          fontSize: "8px", fontWeight: "700", letterSpacing: "1.5px",
          padding: "3px 7px", borderRadius: "4px", fontFamily: T.fontMono,
        }}>
          {card.category}
        </div>

        {/* Distance */}
        <div style={{
          position: "absolute", top: "10px", right: "10px",
          background: "rgba(0,0,0,0.55)", color: T.grey1,
          fontSize: "9px", padding: "3px 7px", borderRadius: "4px",
          fontFamily: T.fontMono, display: "flex", alignItems: "center", gap: "4px",
        }}>
          <span style={{ color: T.yellow, fontSize: "7px" }}>●</span> {card.distance}
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: "1px", background: T.surface3 }} />

      {/* Content */}
      <div style={{ padding: "14px" }}>
        <div style={{ color: T.grey2, fontSize: "8px", fontWeight: "700", letterSpacing: "2px", marginBottom: "3px", fontFamily: T.fontMono }}>
          {card.partnerType}
        </div>
        <div style={{ color: T.white, fontSize: "11px", fontWeight: "800", letterSpacing: "0.5px", marginBottom: "10px", fontFamily: T.fontDisplay }}>
          {card.partner}
        </div>

        {/* Reward hero */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginBottom: "14px" }}>
          <span style={{ color: T.white, fontSize: compact ? "20px" : "24px", fontWeight: "900", fontFamily: T.fontDisplay, lineHeight: 1 }}>
            {card.reward}
          </span>
          <span style={{ color: T.grey1, fontSize: "11px" }}>{card.detail}</span>
        </div>

        <div style={{ height: "1px", background: T.surface3, marginBottom: "12px" }} />

        {/* Points + CTA */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <div style={{ width: "6px", height: "6px", background: T.yellow, borderRadius: "50%" }} />
            <span style={{ color: T.yellow, fontSize: "14px", fontWeight: "900", fontFamily: T.fontDisplay }}>
              {card.points.toLocaleString()}
            </span>
            <span style={{ color: T.grey2, fontSize: "9px", letterSpacing: "1px" }}>PTS</span>
          </div>

          <div style={{
            background: hovered ? T.yellow : T.surface2,
            border: `1px solid ${hovered ? T.yellow : T.grey3}`,
            color: hovered ? T.black : T.grey2,
            fontSize: "9px", fontWeight: "800",
            padding: "5px 11px", borderRadius: T.radiusSm,
            transition: "all 0.2s", fontFamily: T.fontDisplay, letterSpacing: "0.5px",
          }}>
            CLAIM
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// MAIN STYLE GUIDE
// ─────────────────────────────────────────

const TABS = ["Colours", "Typography", "Components", "Tokens", "Cards"];

export default function App() {
  const [tab, setTab] = useState("Colours");

  return (
    <div style={{ minHeight: "100vh", background: T.black, color: T.white, fontFamily: T.fontBody }}>
      {/* Top bar */}
      <div style={{
        borderBottom: `1px solid ${T.surface3}`,
        padding: "0 32px",
        display: "flex", alignItems: "center", gap: "32px",
        position: "sticky", top: 0, background: T.black, zIndex: 10,
      }}>
        <div style={{ padding: "16px 0", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{
            width: "28px", height: "28px", background: T.yellow, borderRadius: "6px",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "14px", fontWeight: "900", color: T.black, fontFamily: T.fontDisplay,
          }}>P</div>
          <div>
            <div style={{ fontSize: "12px", fontWeight: "800", letterSpacing: "2px", fontFamily: T.fontDisplay }}>POWR</div>
            <div style={{ fontSize: "8px", color: T.grey2, letterSpacing: "1.5px", fontFamily: T.fontMono }}>DESIGN SYSTEM v1.0</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "2px" }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: "none", border: "none", cursor: "pointer",
              color: tab === t ? T.yellow : T.grey2,
              fontSize: "11px", fontWeight: "700", letterSpacing: "0.5px",
              padding: "20px 14px",
              borderBottom: tab === t ? `2px solid ${T.yellow}` : "2px solid transparent",
              transition: "all 0.15s",
              fontFamily: T.fontBody,
            }}>{t}</button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "40px 24px" }}>

        {/* ── COLOURS ── */}
        {tab === "Colours" && (
          <div>
            <SectionLabel>Primary Palette</SectionLabel>
            <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", marginBottom: "40px" }}>
              <ColourSwatch hex={T.yellow} name="POWR Yellow" desc="Primary accent. CTA, points, highlights." large />
              <ColourSwatch hex={T.black} name="Background" desc="True black. All screens." large />
              <ColourSwatch hex={T.surface1} name="Surface 1" desc="Card backgrounds." large />
              <ColourSwatch hex={T.surface2} name="Surface 2" desc="Image zones, elevated." large />
              <ColourSwatch hex={T.white} name="White" desc="Primary text." large />
            </div>

            <SectionLabel>Grey Scale</SectionLabel>
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "40px" }}>
              {[["#888888", "Grey 1", "Secondary text"], ["#555555", "Grey 2", "Tertiary / labels"], ["#333333", "Grey 3", "Disabled / dividers"], ["#222222", "Grey 4", "Borders"], ["#1A1A1A", "Surface 2", "Elevated bg"]].map(([hex, name, desc]) => (
                <ColourSwatch key={hex} hex={hex} name={name} desc={desc} />
              ))}
            </div>

            <SectionLabel>Category Accents — Use sparingly</SectionLabel>
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "40px" }}>
              <ColourSwatch hex={T.catFashion} name="Fashion" desc="Purple" />
              <ColourSwatch hex={T.catGear} name="Gear" desc="Blue" />
              <ColourSwatch hex={T.catNutrition} name="Nutrition" desc="Amber" />
              <ColourSwatch hex={T.catGym} name="Gym" desc="Red" />
            </div>

            <SectionLabel>Usage Rules</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              {[
                ["✅ DO", "Use Yellow for points values, active CTAs, active states, and live indicators."],
                ["✅ DO", "Use White for all primary text — headings, reward titles, partner names."],
                ["✅ DO", "Use Grey 1–2 for secondary labels, metadata, and distances."],
                ["❌ DON'T", "Don't put Yellow text directly over image content — always separate with a surface."],
                ["❌ DON'T", "Don't use Yellow as a background for large areas — it's an accent only."],
                ["❌ DON'T", "Don't mix category accent colours in the same component — one accent per card max."],
              ].map(([tag, rule]) => (
                <div key={rule} style={{ background: T.surface1, border: `1px solid ${T.surface3}`, borderRadius: T.radiusMd, padding: "14px" }}>
                  <div style={{ color: tag.startsWith("✅") ? "#4ade80" : "#f87171", fontSize: "10px", fontWeight: "700", marginBottom: "6px", fontFamily: T.fontMono }}>{tag}</div>
                  <div style={{ color: T.grey1, fontSize: "12px", lineHeight: 1.5 }}>{rule}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── TYPOGRAPHY ── */}
        {tab === "Typography" && (
          <div>
            <SectionLabel>Type Scale</SectionLabel>
            <TypeSample label="DISPLAY · Arial Black · Headings, rewards, partner names" style={{ fontFamily: T.fontDisplay, fontSize: "36px", fontWeight: "900", color: T.white, lineHeight: 1 }}>
              Move More.
            </TypeSample>
            <TypeSample label="DISPLAY YELLOW · Points values, CTAs" style={{ fontFamily: T.fontDisplay, fontSize: "28px", fontWeight: "900", color: T.yellow, lineHeight: 1 }}>
              2,500 PTS
            </TypeSample>
            <TypeSample label="HEADING · 18–22px · Section titles" style={{ fontFamily: T.fontDisplay, fontSize: "20px", fontWeight: "800", color: T.white, letterSpacing: "1px" }}>
              NEARBY REWARDS
            </TypeSample>
            <TypeSample label="SUBHEADING · 13–15px · Card reward copy" style={{ fontFamily: T.fontDisplay, fontSize: "14px", fontWeight: "800", color: T.white }}>
              1/3 Off All Trainers
            </TypeSample>
            <TypeSample label="BODY · Helvetica Neue · 12–13px · Descriptions" style={{ fontFamily: T.fontBody, fontSize: "13px", color: T.grey1, lineHeight: 1.6 }}>
              POWR rewards your movement across gyms, studios and sports venues.
            </TypeSample>
            <TypeSample label="LABEL · monospace · 9–10px · Badges, metadata" style={{ fontFamily: T.fontMono, fontSize: "10px", letterSpacing: "2px", color: T.grey2, textTransform: "uppercase" }}>
              SPORTSWEAR · 0.3 MI · FASHION
            </TypeSample>

            <SectionLabel>Rules</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {[
                "Reward values and partner names always use Arial Black (fontDisplay).",
                "Points numbers are always Yellow (#FFD600) + Arial Black. Never any other colour.",
                "All labels, badges, and metadata use monospace for technical feel.",
                "No font sizes below 8px. Minimum legible size for dark backgrounds is 10px.",
                "Letter-spacing on uppercase labels: minimum 1.5px.",
              ].map(r => (
                <div key={r} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                  <span style={{ color: T.yellow, fontSize: "10px", marginTop: "2px" }}>—</span>
                  <span style={{ color: T.grey1, fontSize: "12px", lineHeight: 1.5 }}>{r}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── COMPONENTS ── */}
        {tab === "Components" && (
          <div>
            <SectionLabel>Badges</SectionLabel>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "32px" }}>
              <Badge variant="yellow">ACTIVE</Badge>
              <Badge variant="fashion">FOOD</Badge>
              <Badge variant="gear">GEAR</Badge>
              <Badge variant="nutrition">NUTRITION</Badge>
              <Badge variant="default">0.3 MI</Badge>
            </div>

            <SectionLabel>Buttons</SectionLabel>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "32px" }}>
              {[
                { label: "CLAIM REWARD", bg: T.yellow, color: T.black, border: T.yellow },
                { label: "VIEW ALL", bg: T.surface2, color: T.white, border: T.surface3 },
                { label: "DISABLED", bg: T.surface2, color: T.grey3, border: T.surface3 },
                { label: "GHOST", bg: "transparent", color: T.yellow, border: T.yellow },
              ].map(b => (
                <button key={b.label} style={{
                  background: b.bg, color: b.color, border: `1px solid ${b.border}`,
                  padding: "10px 20px", borderRadius: T.radiusSm, cursor: "pointer",
                  fontSize: "10px", fontWeight: "800", letterSpacing: "1px",
                  fontFamily: T.fontDisplay,
                }}>
                  {b.label}
                </button>
              ))}
            </div>

            <SectionLabel>Points Display Variants</SectionLabel>
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "32px" }}>
              {/* Large */}
              <div style={{ background: T.surface1, border: `1px solid ${T.surface3}`, borderRadius: T.radiusMd, padding: "16px 20px", textAlign: "center" }}>
                <div style={{ color: T.grey2, fontSize: "9px", letterSpacing: "2px", fontFamily: T.fontMono, marginBottom: "4px" }}>BALANCE</div>
                <div style={{ color: T.yellow, fontSize: "32px", fontWeight: "900", fontFamily: T.fontDisplay }}>12,450</div>
                <div style={{ color: T.grey2, fontSize: "10px", letterSpacing: "1.5px", fontFamily: T.fontMono }}>POWR PTS</div>
              </div>
              {/* Inline */}
              <div style={{ background: T.surface1, border: `1px solid ${T.surface3}`, borderRadius: T.radiusMd, padding: "12px 16px", display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ width: "8px", height: "8px", background: T.yellow, borderRadius: "50%" }} />
                <span style={{ color: T.yellow, fontSize: "18px", fontWeight: "900", fontFamily: T.fontDisplay }}>2,500</span>
                <span style={{ color: T.grey2, fontSize: "10px", letterSpacing: "1px" }}>PTS</span>
              </div>
              {/* Earning */}
              <div style={{ background: "#FFD60011", border: `1px solid ${T.yellowMid}`, borderRadius: T.radiusMd, padding: "10px 14px", display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ color: T.yellow, fontSize: "12px", fontWeight: "700" }}>+</span>
                <span style={{ color: T.yellow, fontSize: "14px", fontWeight: "900", fontFamily: T.fontDisplay }}>50 PTS</span>
                <span style={{ color: T.grey1, fontSize: "10px" }}>Morning Run</span>
              </div>
            </div>

            <SectionLabel>Dividers</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "32px" }}>
              <div style={{ height: "1px", background: T.surface3 }} />
              <div style={{ height: "1px", background: `linear-gradient(90deg, transparent, ${T.yellow}44, transparent)` }} />
            </div>

            <SectionLabel>Live Indicator</SectionLabel>
            <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <div style={{ position: "relative" }}>
                  <div style={{ width: "8px", height: "8px", background: T.yellow, borderRadius: "50%" }} />
                  <div style={{ position: "absolute", inset: "-3px", border: `1px solid ${T.yellow}`, borderRadius: "50%", opacity: 0.4 }} />
                </div>
                <span style={{ color: T.grey1, fontSize: "11px", fontFamily: T.fontMono }}>TRACKING ACTIVE</span>
              </div>
            </div>
          </div>
        )}

        {/* ── TOKENS ── */}
        {tab === "Tokens" && (
          <div>
            <SectionLabel>Colour Tokens — click to copy</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "32px" }}>
              {[
                ["--powr-yellow", T.yellow],
                ["--powr-yellow-dim", T.yellowDim],
                ["--powr-black", T.black],
                ["--powr-surface-1", T.surface1],
                ["--powr-surface-2", T.surface2],
                ["--powr-surface-3", T.surface3],
                ["--powr-white", T.white],
                ["--powr-grey-1", T.grey1],
                ["--powr-grey-2", T.grey2],
                ["--powr-grey-3", T.grey3],
              ].map(([n, v]) => <Token key={n} name={n} value={v} />)}
            </div>

            <SectionLabel>Spacing Tokens</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "32px" }}>
              {[["--powr-sp-1", "4px"], ["--powr-sp-2", "8px"], ["--powr-sp-3", "12px"], ["--powr-sp-4", "16px"], ["--powr-sp-5", "24px"], ["--powr-sp-6", "32px"], ["--powr-sp-7", "48px"]].map(([n, v]) => <Token key={n} name={n} value={v} />)}
            </div>

            <SectionLabel>Border Radius Tokens</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {[["--powr-radius-sm", "6px"], ["--powr-radius-md", "12px"], ["--powr-radius-lg", "16px"]].map(([n, v]) => <Token key={n} name={n} value={v} />)}
            </div>
          </div>
        )}

        {/* ── CARDS ── */}
        {tab === "Cards" && (
          <div>
            <SectionLabel>Standard Reward Card</SectionLabel>
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "40px" }}>
              {cards.map(c => <RewardCard key={c.id} card={c} />)}
            </div>

            <SectionLabel>Compact Variant</SectionLabel>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "40px" }}>
              {cards.map(c => <RewardCard key={c.id} card={c} compact />)}
            </div>

            <SectionLabel>Card Anatomy</SectionLabel>
            <div style={{ background: T.surface1, border: `1px solid ${T.surface3}`, borderRadius: T.radiusLg, overflow: "hidden", maxWidth: "300px" }}>
              {[
                { label: "① IMAGE ZONE", desc: "Dark surface (#1A1A1A). Contains only: image/icon, category badge (top-left), distance (top-right). No reward text here.", bg: "#1A1A1A", h: "100px" },
                { label: "② DIVIDER", desc: "1px #222 hard rule. Forces clean visual separation.", bg: T.surface3, h: "1px" },
                { label: "③ CONTENT ZONE", desc: "Partner type → Partner name → Reward headline → Divider → Points + CTA", bg: T.surface1, h: "auto" },
              ].map(z => (
                <div key={z.label} style={{ background: z.bg, padding: z.h === "1px" ? "0" : "14px", minHeight: z.h, borderBottom: `1px dashed ${T.yellow}44`, position: "relative" }}>
                  {z.h !== "1px" && (
                    <>
                      <div style={{ color: T.yellow, fontSize: "9px", fontFamily: T.fontMono, fontWeight: "700", marginBottom: "4px" }}>{z.label}</div>
                      <div style={{ color: T.grey1, fontSize: "11px", lineHeight: 1.5 }}>{z.desc}</div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
