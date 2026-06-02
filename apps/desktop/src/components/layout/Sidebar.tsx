import {
  ClockCounterClockwise,
  Sliders,
  Microphone,
  ChartBar,
  Gear,
  User,
  TextAa,
  BookOpenText,
} from "@phosphor-icons/react";
import NavItem from "./NavItem";
import PopoMark from "./PopoMark";

/**
 * Sidebar — the 64px icon rail per brief §3 Sidebar.
 *
 *   Width 64px · bg --bg-void
 *   Top group (vertically centered): History / Modes / Test / Stats
 *   Bottom group (pinned bottom):    Settings / Account
 *   Top glyph 16px PopoMark · bottom version string "v0.1" GeistPixelGrid 9px
 *
 * No border between sidebar and content area — depth is color only
 * (--bg-void sidebar vs --bg-base content). See brief §3 hard rules.
 *
 * Drag region: the top 40px is the Tauri drag region; the NavItems below
 * it are regular clickable children.
 */

const APP_VERSION = "v0.1";

export default function Sidebar() {
  return (
    <aside
      style={{
        position: "relative", // for drag-region child absolute positioning
        width: 64,
        flexShrink: 0,
        height: "100%",
        background: "var(--bg-void)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {/*
        Top 40px drag region. The glyph sits inside it, centered.
        Session 56: bumped height from 40 → 56 px to give the larger
        logo (28 px, up from 16) comfortable breathing room within
        the drag zone. NavItems below still click-trigger normally.
      */}
      <div
        data-tauri-drag-region
        style={{
          height: 72,
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          // 72px container with 40px logo = 16px padding top+bottom.
          // Feels balanced without cramping the nav items below.
        }}
      >
        <PopoMark size={40} />
      </div>

      {/* Top nav group — vertically centered in remaining space */}
      <nav
        aria-label="Primary"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          width: "100%",
        }}
      >
        <NavItem to="/history" label="History" icon={ClockCounterClockwise} />
        <NavItem to="/modes" label="Modes" icon={Sliders} />
        <NavItem to="/snippets" label="Snippets" icon={TextAa} />
        <NavItem to="/dictionary" label="Dictionary" icon={BookOpenText} />
        <NavItem to="/test" label="Test" icon={Microphone} />
        <NavItem to="/stats" label="Stats" icon={ChartBar} />
      </nav>

      {/* Bottom nav group — pinned */}
      <nav
        aria-label="Secondary"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          marginBottom: 12,
        }}
      >
        <NavItem to="/settings" label="Settings" icon={Gear} />
        <NavItem to="/account" label="Account" icon={User} />
      </nav>

      {/* Version footer */}
      <div
        style={{
          marginBottom: 16,
          // Session 55 retune: was text-2xs (9 px) + ghost (1.7:1
          // contrast) which rendered as nearly-invisible. Bumped to
          // text-xs (11 px) + secondary (~4.5:1 contrast) so the
          // version is actually findable. Still subordinate to
          // anything else in the sidebar (icons are 18 px primary)
          // — just no longer fighting the user.
          fontFamily: "var(--font-pixel-grid)",
          fontSize: "var(--text-xs)",
          lineHeight: 1.2,
          color: "var(--text-secondary)",
          letterSpacing: "0.02em",
        }}
      >
        {APP_VERSION}
      </div>
    </aside>
  );
}
