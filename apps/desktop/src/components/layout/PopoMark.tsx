/**
 * PopoMark — the sidebar-only quieter glyph.
 *
 * Three vertical pill bars (short / tall / medium) on a transparent
 * background, rendered in --text-ghost so they read as a subtle
 * wayfinding element rather than demanding attention.
 *
 * This is INTENTIONALLY DIFFERENT from `PopoIcon` (the canonical
 * app-icon tile with the warm-white rounded square). The tile is
 * right for external contexts where popo is fighting for attention
 * (taskbar, splash, installer sidebar). Inside the app, where the
 * user has already opened popo and doesn't need convincing, a full
 * warm-white tile in the top-left would fight the dark canvas — the
 * subtle bars fit the calm sidebar tone much better.
 *
 * Used only in `components/layout/Sidebar.tsx`. Everywhere else,
 * `components/shared/PopoIcon.tsx` is the correct choice.
 */

export interface PopoMarkProps {
  size?: number;
  color?: string;
}

export default function PopoMark({
  size = 16,
  color = "var(--text-ghost)",
}: PopoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="popo"
      role="img"
    >
      {/* Short left bar */}
      <rect x="2" y="6" width="2" height="4" rx="1" fill={color} />
      {/* Tall middle bar */}
      <rect x="6.5" y="3" width="2" height="10" rx="1" fill={color} />
      {/* Medium right bar */}
      <rect x="11" y="5" width="2" height="6" rx="1" fill={color} />
    </svg>
  );
}
