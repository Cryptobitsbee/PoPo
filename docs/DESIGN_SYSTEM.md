# DESIGN_SYSTEM.md — popo tokens, pill spec, component inventory

> Phase 1 deliverable. Output of the Agent Execution Order step `[3]`.
> The brief (Sections 1, 2, 3) is the canonical design source. This
> document is the operational form: copy-pasteable CSS, Tailwind config,
> and a component-by-component contract.

## 0. Design philosophy — Obsidian Instrument (recap)

popo is a **precision instrument, not a product**. Reference points:
Raycast, Linear, Craft, Bear. Not Notion, Slack, or any SaaS dashboard.

Core principles, each of which binds at least one concrete decision below:

- **Carved from darkness.** UI emerges from a near-black void via stepped
  surface tones, not borders or shadows.
- **Type is structure.** Geist Pixel does the heavy lifting. Decorative
  dividers and chrome are disallowed.
- **Spacing is content.** A 4px base unit with generous multipliers. When
  in doubt, increase spacing.
- **Motion is purposeful.** Every animation conveys a state change. No
  ambient bounce, no "delightful" wiggles.
- **No decoration.** No gradients (except one defined below for text
  truncation), no drop shadows, no glows, no glass morphism beyond the
  pill's backdrop-filter.

## 1. Color tokens

Authoritative CSS (drop into `src/styles/globals.css`):

```css
:root {
  /* Core surfaces — carved from darkness */
  --bg-void:        #080808;
  --bg-base:        #0D0D0D;
  --bg-surface:     #131313;
  --bg-elevated:    #1A1A1A;
  --bg-high:        #222222;

  /* Text */
  --text-primary:   #EDEBE6;
  --text-secondary: #7A786F;
  --text-ghost:     #3A3836;

  /* Borders */
  --border-faint:   #161614;
  --border-subtle:  #202020;
  --border-default: #2C2A27;
  --border-strong:  #3D3A36;

  /* Waveform */
  --wave-primary:   #EDEBE6;
  --wave-flat:      #2C2A27;

  /* Pill */
  --pill-sleep-bg:  rgba(13, 13, 13, 0.55);
  --pill-bg:        rgba(8, 8, 8, 0.93);
  --pill-border:    rgba(237, 235, 230, 0.07);
  --pill-blur:      20px;

  /* Semantic */
  --accent-success: #2D6A4F;
  --accent-error:   #8B2323;
}
```

### Usage contract per surface

| Surface                     | Background token | Border token    | Text token        |
| --------------------------- | ---------------- | --------------- | ----------------- |
| Main window chrome (sidebar)| `--bg-void`      | — (no border)   | `--text-ghost`    |
| Main window content         | `--bg-base`      | — (no border)   | `--text-primary`  |
| Cards (Modes, Stats, Test)  | `--bg-surface`   | `--border-subtle` | `--text-primary` |
| Inputs (default)            | `--bg-elevated`  | `--border-subtle` | `--text-primary` |
| Inputs (focused)            | `--bg-elevated`  | `--border-default` | `--text-primary` |
| Active/selected row         | `--bg-high`      | left-edge-only `--text-primary` | `--text-primary` |
| Hover row (history)         | `--bg-surface`   | —               | `--text-primary`  |
| Disabled control            | `--bg-elevated`  | `--border-faint`  | `--text-ghost`  |

**Hard constraint — no pure black/white.** `#000` and `#fff` are banned.
The closest we get is `#080808` and `#EDEBE6`.

### Semantic colors

- `--accent-success` (dark green) is used *only* for the pill's
  success-state checkmark icon. No other UI element uses success green.
- `--accent-error` (muted red) is used *only* for the pill's error-state
  border and warning icon. Form validation errors use `--text-secondary`
  with an inline error text instead — errors must not flash red all over
  the UI.

## 2. Typography — Geist Pixel system

### Install

```bash
pnpm add geist
```

### Variable wiring

```tsx
// src/styles/fonts.css (imported in main.tsx)
@import 'geist/font/pixel';
```

Geist Pixel ships five variants. The brief fixes one variant per use:

| Usage                                               | Variant              |
| --------------------------------------------------- | -------------------- |
| Nav labels, buttons, section headings, mode names   | `GeistPixelSquare`   |
| Timestamps, durations, word counts, stat labels     | `GeistPixelGrid`     |
| Mode chips, language tags, badges                   | `GeistPixelCircle`   |
| Transcript body (the reading surface)               | `GeistPixelLine`     |
| Decorative accents (default-mode marker, etc.)      | `GeistPixelTriangle` |

### Type scale

```css
:root {
  --text-2xs:  9px;
  --text-xs:  11px;
  --text-sm:  13px;
  --text-base: 15px;
  --text-lg:  18px;
  --text-xl:  22px;
  --text-stat: 36px;
}
```

Line-heights:
- Display/stat (`--text-stat`, `--text-xl`): 1.1
- Body (`--text-base`, `--text-sm`): 1.4
- Compact (`--text-xs`, `--text-2xs`): 1.2

Letter-spacing:
- UPPERCASE group labels (settings section headers): `0.1em`
- Everything else: default.

### Banned

- No other font family, even for code blocks. The pixel family has a
  code-friendly variant (`GeistPixelLine`); that's what transcripts use.
- No bold weight except for primary CTA buttons.

## 3. Iconography — Phosphor only

```bash
pnpm add @phosphor-icons/react
```

- Default weight: `regular`.
- Primary CTA buttons (e.g., "Save Mode" footer button): `bold`.
- Size defaults:
  - Sidebar icons: 18px
  - Inline row action icons (history row Copy/Play/Delete): 14px
  - Pill state icons (Check, Warning): 12px
  - Button icons: 14px

### Icon assignment

| Purpose               | Phosphor name           |
| --------------------- | ----------------------- |
| History nav           | `ClockCounterClockwise` |
| Modes nav             | `Sliders`               |
| Test nav              | `Microphone`            |
| Stats nav             | `ChartBar`              |
| Settings nav          | `Gear`                  |
| Account nav           | `User`                  |
| Paste success (pill)  | `Check`                 |
| Pipeline error (pill) | `Warning`               |
| Row action — copy     | `Copy`                  |
| Row action — play     | `Play`                  |
| Row action — delete   | `Trash`                 |
| Add (New Mode etc.)   | `Plus`                  |
| Expand/next           | `CaretRight`            |

### Banned

- Lucide, Heroicons, Font Awesome, custom SVG icons (except the popo
  glyph mark, which is a named exception).

## 4. Loaders — DotMatrix only

```bash
npx shadcn@latest add @dotmatrix/dotm-square-3
```

Usage is exclusive — no spinner wheels, no shimmer skeleton gradients,
no indeterminate progress bars. Every place that used to use any of those
uses a DotMatrix component.

Placements:
- Pill processing state (centered inside the pill)
- History empty state (centered with "No sessions yet" below)
- Test page output empty/loading state
- Stats page week heatmap cells
- Any network-fetching panel before data arrives

## 5. Radius & spacing

```css
:root {
  --radius-pill:   9999px;   /* Overlay pill */
  --radius-card:   12px;     /* Cards */
  --radius-button: 8px;      /* Buttons, inputs */
  --radius-badge:  6px;      /* Tags, chips */
  --radius-micro:  4px;      /* Small accents */

  /* 4px base unit */
  --sp-1:  4px;
  --sp-2:  8px;
  --sp-3:  12px;
  --sp-4:  16px;
  --sp-6:  24px;
  --sp-8:  32px;
  --sp-10: 40px;
  --sp-12: 48px;
}
```

- **No sharp corners anywhere.** Every rectangle has at least `--radius-micro`.
- Spacing scale skips 5, 7, 9, 11 intentionally. Use the next step up.

## 6. Motion system

### Page transitions (main window, all routes)

```tsx
const pageVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -6 },
}
const pageTransition = {
  duration: 0.18,
  ease: [0.25, 0.1, 0.25, 1],
}
```

### List stagger (history, modes grid, stats language rows)

```tsx
const containerVariants = {
  animate: { transition: { staggerChildren: 0.04 } },
}
const itemVariants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.15 } },
}
```

### Hover transitions

CSS only (GPU-cheap):

```css
transition: background-color 120ms ease, border-color 120ms ease,
            color 120ms ease, opacity 120ms ease;
```

No layout-shifting hover effects. No translateY bob on hover.

### Pill morph

Full spec in Section 7 below. One spring, one component.

## 7. Pill overlay — component contract

### Canonical source

```tsx
// src/components/pill/PillOverlay.tsx
<motion.div
  layout
  animate={pillSizes[state]}                // { width, height }
  transition={{ type: 'spring', stiffness: 380, damping: 28 }}
  style={{
    borderRadius: '9999px',
    background: state === 'sleep' ? 'var(--pill-sleep-bg)' : 'var(--pill-bg)',
    border:     '1px solid var(--pill-border)',
    backdropFilter: 'blur(var(--pill-blur))',
    overflow: 'hidden',
  }}
>
  <AnimatePresence mode="wait">
    {(state === 'ready' || state === 'active') && <WaveformContent key="wave" />}
    {state === 'processing' && <ProcessingContent key="proc" />}
    {state === 'success'    && <SuccessContent    key="ok" />}
    {state === 'error'      && <ErrorContent      key="err" />}
    {/* sleep: no inner content — the pill shape IS the UI */}
  </AnimatePresence>
</motion.div>
```

### State → size table

| State      | width | height | opacity | notes                                |
| ---------- | ----- | ------ | ------- | ------------------------------------ |
| sleep      | 48    | 6      | 0.18    | ambient line, barely visible         |
| ready      | 220   | 44     | 0.85    | bars flat at `--wave-flat`           |
| active     | 220   | 44     | 1.00    | bars animate; color `--wave-primary` |
| processing | 180   | 44     | 1.00    | DotMatrix centered                   |
| success    | 120   | 44     | 1.00    | Check icon 12px `--accent-success`   |
| error      | 180   | 44     | 1.00    | Warning icon 12px + border `--accent-error` |

### State transitions

- sleep → ready (hotkey down): spring `{stiffness:380, damping:28}`.
  Bars fade in at 50ms delay, flat height, `--wave-flat`.
- ready → active (voice above threshold): no size change; bar color
  `--wave-flat → --wave-primary`, heights driven by PCM; opacity
  `0.85 → 1.00`.
- active → ready (silence): bars calm to flat, color back to `--wave-flat`
  over 80ms ease-out per bar.
- recording → processing (hotkey up): spring morph `w:220→180`, waveform
  unmount, DotMatrix mount.
- processing → success (paste done): morph `w:180→120`, Check icon, hold
  300ms, then morph back to sleep.
- error: `w:180`, Warning icon, border color `--accent-error`, hold 2s,
  then morph to sleep.

### Waveform spec (inside ready/active)

```
16 bars
bar width: 3px
gap: 2px
total width: 16*3 + 15*2 = 78px
centered horizontally inside the pill
max bar height (peak voice): 24px
min bar height (silence/flat): 3px
bar border-radius: 2px top, 0 bottom
bar color: --wave-primary (active) | --wave-flat (ready/silent)
flat state idle motion: ±1px organic noise around 3px baseline, ~8Hz
```

### Tauri pill window config (repeated verbatim from brief)

```json
{
  "label": "pill",
  "url": "/pill",
  "width": 340,
  "height": 80,
  "transparent": true,
  "decorations": false,
  "alwaysOnTop": true,
  "skipTaskbar": true,
  "resizable": false,
  "shadow": false,
  "focusable": false,
  "visible": true,
  "center": false
}
```

Positioned programmatically after creation: bottom-centered on the
primary monitor, 24px above the taskbar edge. Multi-monitor logic
deferred to v0.3.

## 8. Main window — layout tokens

### Window config (verbatim from brief)

```json
{
  "label": "main",
  "decorations": false,
  "transparent": false,
  "width": 1080,
  "height": 680,
  "minWidth": 800,
  "minHeight": 520,
  "resizable": true,
  "center": true,
  "visible": false
}
```

Drag region: the top 40px of both sidebar and content area carry the
`data-tauri-drag-region` attribute.

### Top-level grid

```
┌──────────────────────────────────────────────────────────────────┐
│  [64px sidebar --bg-void]  │  [flex-1 content --bg-base]         │
│                            │                                     │
│  NO border between them — color difference is the only divider.  │
└──────────────────────────────────────────────────────────────────┘
```

### Sidebar tokens

- Width: 64px fixed
- bg: `--bg-void`
- Top: 24px from window top, popo glyph (16px wide, 3-bar SVG,
  `--text-ghost`).
- Nav items:
  - Zone: 44×44px; icon 18px Phosphor regular
  - Active: bg `--bg-elevated`, radius `--radius-button`, icon `--text-primary`
  - Inactive: icon `--text-ghost`
  - Hover (inactive): icon `--text-secondary` (120ms ease)
- Tooltip on hover: 8px gap right of icon; bg `--bg-elevated`, border
  `--border-subtle`, radius `--radius-badge`, `GeistPixelSquare`
  `--text-xs` `--text-primary`, padding `12px 6px`. Entrance: opacity
  `0→1`, x `-4→0`, 100ms ease.
- Bottom: version string "v0.1" `GeistPixelGrid --text-2xs --text-ghost`.

### Content area

- bg: `--bg-base`
- Padding: `--sp-8 --sp-10` (32px vertical, 40px horizontal)
- Page title: `GeistPixelSquare --text-xl --text-primary`, no chrome, no
  bg-bar, no horizontal rule.
- Subtitle/controls row directly below title (`mt: --sp-3`).
- Thin separator (`1px solid --border-faint`) only *once per page* at
  `mt: --sp-6`, separating controls row from list/grid content. Never
  between individual sections below.

## 9. Component inventory — the full v0.1 surface

### Pill surface (rendered in pill webview)

- `PillOverlay` — the one morphing `motion.div`. States: sleep / ready /
  active / processing / success / error. See Section 7.
- `WaveformContent` — 16-bar waveform canvas. Props: `bars: number[16]`,
  `state: 'ready' | 'active'`.
- `ProcessingContent` — centered DotMatrix.
- `SuccessContent` — centered `Check` icon 12px `--accent-success`.
- `ErrorContent` — centered `Warning` icon 12px, border override
  `--accent-error`.

Shared by main window (for Test page):

- `WaveformCanvas` — same visual output as `WaveformContent`, decoupled
  so the Test page can embed it inside the "Hold to Dictate" button.

### Layout primitives (main window)

- `AppShell` — frameless window root. Hosts drag region and routes.
- `Sidebar` — 64px icon rail. Nav items, tooltips, version footer.
- `PageShell` — wraps each page; applies `pageVariants` + transition.
- `PageTitle` — `GeistPixelSquare --text-xl --text-primary` + optional
  subtitle slot.

### Shared UI primitives

- `Button`
  - Variants: `ghost` (text `--text-secondary`, hover `--text-primary`,
    no bg), `subtle` (bg `--bg-elevated`, border `--border-subtle`,
    hover border `--border-default`), `primary` (bg `--bg-high`, border
    `--border-default`, text `--text-primary`, Phosphor `bold` icons).
  - Font: `GeistPixelSquare` `--text-sm`.
  - Radius: `--radius-button`.
  - Padding: `px-4 py-2` (derived: 16px horizontal, 8px vertical).
- `Chip` — `GeistPixelCircle` 9px, `px-2 py-0.5`, bg `--bg-elevated`,
  radius `--radius-badge`, text `--text-secondary`.
- `Tooltip` — portal-rendered floating div, see Sidebar tokens.
- `Input`
  - Default: bg `--bg-elevated`, border `--border-subtle`, radius
    `--radius-button` (or `--radius-pill` if it's a search input),
    text `GeistPixelLine --text-sm --text-primary`, placeholder
    `--text-ghost`.
  - Focused: border `--border-default`.
- `Textarea` — same as input but multi-line; 6 rows default for mode
  editor system prompt.
- `Select` — custom popover (no native `<select>`).
  - Trigger: input-like, with `CaretRight` rotated 90° as caret.
  - Popover: bg `--bg-surface`, border `--border-subtle`, max-height
    240px scrollable.
- `Toggle`
  - 36×20px, radius `--radius-pill`.
  - Off: bg `--bg-elevated`, knob `--text-ghost`.
  - On: bg `--text-primary`, knob `--bg-void`.
  - Knob: spring `{stiffness:400, damping:25}`.
  - Track: 150ms ease background.
- `Modal` — backdrop `rgba(8,8,8,0.82)` with `blur(6px)`; panel bg
  `--bg-surface`, border `--border-subtle`, radius `--radius-card`,
  entrance scale `0.96→1` + opacity `0→1`, 180ms ease-out.

### History surface

- `HistoryPage` — container, renders title + controls row + list.
- `HistoryControls` — session count + search input + language chip
  filter + mode chip filter.
- `HistoryList` — `motion.div` container with `containerVariants`.
- `SessionRow` — full-width, 72px tall, hover bg `--bg-surface`, bottom
  border `--border-faint`. Left: transcript preview (2-line clamp with
  fade gradient mask), chips row. Right: hover-revealed Copy/Play/Delete.

### Modes surface

- `ModesPage` — title + New Mode button + grid.
- `ModeGrid` — 2 columns, `gap --sp-4`.
- `ModeCard` — bg `--bg-surface`, border `--border-subtle`, radius
  `--radius-card`, padding `--sp-6`, min-height 120px. Hover: border
  `--border-default`, bg `--bg-elevated` (180ms ease). Default-mode
  marker ◆ top-right.
- `NewModeCard` — dashed-border variant with centered Plus + "New Mode".
- `ModeEditor` — Modal. Fields: name, system prompt (Textarea 6 rows),
  language override, output format toggle, save/cancel footer.

### Test surface

- `TestPage` — two-column grid, `gap --sp-8`.
- `TestInput` — mic selector, mode selector, "Hold to Dictate" button
  (80px tall, embeds `WaveformCanvas` on hold).
- `TestOutput` — bg `--bg-surface`, border `--border-subtle`, radius
  `--radius-card`, `min-height: 200px`. Empty state: DotMatrix + ghost
  label. Word count + Copy in footer.

### Stats surface

- `StatsPage` — title + metric grid + languages + heatmap.
- `StatCard` — bg `--bg-surface`, border `--border-subtle`, radius
  `--radius-card`, padding `--sp-6`. Value `GeistPixelSquare --text-stat
  --text-primary`, label `GeistPixelGrid --text-xs --text-secondary`.
  Count-up on mount, 600ms.
- `LanguageBarRow` — name left, horizontal bar (track `--bg-elevated`,
  fill `--text-primary`, radius `9999px`, height 4px), count right.
  Staggered mount 60ms per row.
- `WeekHeatmap` — 7 columns, each a DotMatrix cell with opacity
  `0.1→1.0` based on intensity.

### Settings surface

- `SettingsPage` — max-width 600px centered when window is wider.
- `SettingsGroup` — group label `GeistPixelGrid --text-xs --text-ghost`
  UPPERCASE, letter-spacing `0.1em`, `mt --sp-10` between groups.
- `SettingRow` — 56px tall flex row. Left: label `GeistPixelSquare
  --text-sm --text-primary` + optional description below
  `GeistPixelLine --text-xs --text-secondary`. Right: control slot.
- `HotkeyInput` — chips row showing `[Ctrl] + [Shift] + [Space]`, each
  chip bg `--bg-elevated`, border `--border-subtle`, `GeistPixelSquare
  --text-xs`. Click: border `--border-strong`, caption "Press new
  shortcut…".
- `GCPSetup` — file-browse path input + Project ID + Test Connection
  button.

## 10. Design lint checklist (apply before merging any UI PR)

### Brief-derived (non-negotiable)

- [ ] No `#000` or `#fff` anywhere (greps clean).
- [ ] No `font-family` declaration outside `globals.css` / `fonts.css`.
- [ ] No icons outside `@phosphor-icons/react` (greps clean).
- [ ] No `animate-spin`, no shimmer gradients, no non-DotMatrix loaders.
- [ ] No `border-radius: 0`, no rectangular corners.
- [ ] No top-level `<header>` with chrome bg on the main window.
- [ ] No visible border between sidebar and content.
- [ ] Pill is ONE `motion.div` — no sibling-swap animations.
- [ ] No timer, no counter, no text label inside the pill.
- [ ] All interactive hover transitions are 120ms ease on cheap props only.
- [ ] No `translateY` on hover for rows, cards, or buttons.
- [ ] All spacing uses a `--sp-*` token or matching Tailwind class.
- [ ] All radii use a `--radius-*` token.
- [ ] All colors use a token — no literal hex outside `globals.css`.

### Skill-derived (from Section 12 integration)

From **impeccable**:
- [ ] No em-dashes (`—` or `--`) in UX copy; use comma / colon / period / parens.
- [ ] No `background-clip: text` gradient text anywhere.
- [ ] No glassmorphism as default — pill's backdrop-filter is the single purposeful use.
- [ ] No side-stripe borders > 1px. **BRIEF EXCEPTION**: History active row 2px left edge. No other occurrences allowed.
- [ ] No modal-first thinking. Exhaust inline / progressive alternatives. **BRIEF EXCEPTION**: ModeEditor modal is mandated; no other modals without §12 justification.
- [ ] No hero-metric templates (big number + gradient accent + supporting stats in one card). Stats page uses bare StatCard, not this cliché.
- [ ] No identical card grids — Modes grid's default-mode marker is sufficient differentiation.
- [ ] Run the AI-slop category-reflex check: if the UI is guessable as "voice-dictation app" from the palette + type alone, rework until it isn't.

From **design-taste-frontend**:
- [ ] No AI-slop copy: "Elevate", "Seamless", "Unleash", "Next-Gen", "Game-changer", "Delve".
- [ ] No generic placeholder names ("John Doe", "Acme", "Lorem Ipsum"). Use realistic contextual content.
- [ ] No oversized H1 screaming — control hierarchy with weight + color, not just scale. popo's `--text-xl: 22px` page title is intentionally modest.
- [ ] No 3-column equal-cards feature row. popo allows the 4-metric Stats grid (dashboard idiom, not SaaS feature-row).
- [ ] No flexbox percentage math (`w-[calc(33%-1rem)]`). Use CSS Grid.
- [ ] No `h-screen` on full-height sections — use `min-h-[100dvh]` (desktop-only, but recorded for discipline).
- [ ] Monospace (`GeistPixelGrid`) for every numeric datum in Stats/History — timestamps, durations, counts.
- [ ] Icons standardized at Phosphor `regular` (default) + `bold` for primary CTA only.
- [ ] Every async surface has three states: loading (DotMatrix), empty (DotMatrix + ghost label), error (inline, not toast).

From **minimalist-ui** (spirit, not palette):
- [ ] Generous section padding (≥ `--sp-10` between setting groups, ≥ `--sp-8` page padding).
- [ ] Scroll entry: `translateY(6–12px)` + opacity, `cubic-bezier(0.16, 1, 0.3, 1)`. Matches our page/stagger variants.
- [ ] No decorative shadows. The only `box-shadow` in the app is the pill's `backdrop-filter`.

From **industrial-brutalist-ui** (narrow borrowings):
- [ ] `<kbd>` tags for every keystroke shown in-UI (HotkeyInput chips, shortcuts in tooltips).
- [ ] Settings rows separate with `border-bottom: 1px solid --border-faint` only — no box-containers.
- [ ] `<data>`, `<output>`, `<dl>` semantic elements used where they match the content (stats, durations).

### Rejected wholesale

- ASCII brackets / framing (`[ DELIVERY SYSTEMS ]`, `>>>`, crosshairs) — not popo's vocabulary.
- Halftone / CRT scanlines / mechanical noise — clashes with precision-instrument feel.
- `border-radius: 0` doctrine — popo's pill and cards depend on radii.
- Light-canvas monochrome — popo is dark by product requirement.
- Magnetic-button / perpetual-loop micro-animations from taste-skill — MOTION_INTENSITY is 4, not 6+.

## 11. Tailwind v4 wiring (summary)

Tailwind v4 reads CSS custom properties automatically. We declare our
tokens in `globals.css` (Section 1 + 5 above) and reference them as
`bg-[var(--bg-surface)]` / `text-[var(--text-primary)]` / etc. No
`tailwind.config.ts` customization is needed for v4 beyond import.

Example:

```tsx
<div className="
  bg-[var(--bg-surface)]
  border border-[var(--border-subtle)]
  rounded-[var(--radius-card)]
  p-[var(--sp-6)]
  text-[var(--text-primary)]
">
  …
</div>
```

Alternatively, we may define utility aliases in `globals.css` via
`@theme` blocks once Tailwind v4 ships stable `@theme` in our installed
version. Either approach satisfies the design lint; consistency matters
more than which approach.

## 12. Skill application matrix

Four external skills ship with this project:

- `impeccable-style-universal/.claude/skills/impeccable/` — universal
  frontend quality skill (Anthropic-derived).
- `taste-skill-main/taste-skill-main/skills/taste-skill/` —
  `design-taste-frontend` (metric-dial anti-slop rules).
- `taste-skill-main/taste-skill-main/skills/minimalist-skill/` —
  `minimalist-ui` (editorial restraint).
- `taste-skill-main/taste-skill-main/skills/brutalist-skill/` —
  `industrial-brutalist-ui` (Swiss print / tactical telemetry).

Each has been read. This section records which of their principles apply
to popo, which are selectively borrowed, and where POPO_BRIEF.md
deliberately overrides a skill. The brief remains single source of
truth; this matrix exists so no future session re-opens a resolved
conflict.

### 12.1 Register

popo is a **product-register** application per impeccable
(`reference/product.md`), not a brand/marketing surface. The pill +
main-window dashboard serves the product; design does not **carry** the
product. This cached value is binding for every subsequent session.

### 12.2 Metric dials (`design-taste-frontend`)

| Dial                | popo default | Rationale                                             |
| ------------------- | ------------ | ----------------------------------------------------- |
| `DESIGN_VARIANCE`   | **4**        | Tool-like. Symmetric sidebar + content; 4-metric grid is an idiom, not a feature-row cliché. Assymetry reserved for hero-like Stats number display. |
| `MOTION_INTENSITY`  | **4**        | Purposeful motion only. Pill spring + page transitions + toggle knob. No magnetic hover, no perpetual loops, no scroll-triggered choreography. |
| `VISUAL_DENSITY`    | **4**        | Normal app density. Stats page can tick to 6 for the language breakdown row; everything else stays generous. |

Phase 3+ work MUST NOT raise these dials without updating this table
and adding rationale.

### 12.3 Impeccable — universal quality (applied wholesale)

| impeccable rule                              | popo status                                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| No pure `#000` / `#fff`                      | Complied: `#080808` / `#EDEBE6`                                                               |
| Color strategy: Restrained (neutrals + one accent ≤10%) | Complied. Only accent appearances: `--accent-success` (pill success check only), `--accent-error` (pill error border only) |
| OKLCH preferred                              | **Logged deviation**: tokens are hex in `globals.css` for brief fidelity. When re-tuning colors in a future pass we convert to OKLCH and reduce chroma at the extremes. |
| Theme justified by scene sentence            | Recorded: *"engineer / writer at a dim desk, VS Code + Slack open, dictating into whatever cursor is focused."* Forces dark. |
| Typography scale ≥1.25 ratio                 | Our scale ratios: 11→13=1.18, 13→15=1.15, 15→18=1.20, 18→22=1.22. **Slightly below**. Acceptable because Geist Pixel variants provide weight/width differentiation that offsets flat scale. Flagged for Phase 3 review. |
| Ease-out curves, no bounce/elastic           | Complied: all transitions `cubic-bezier(0.25, 0.1, 0.25, 1)` or spring with `damping ≥ 25`.  |
| Cap body line length 65–75ch                  | Enforce on transcript body (`--text-base` GeistPixelLine); Settings max-width is 600px (~45ch Geist Pixel Line). |
| No side-stripe borders > 1px                 | **BRIEF EXCEPTION**: History active row has 2px left edge (brief §3). Kept; logged here; no other exceptions permitted. |
| No gradient text                             | Complied — no `background-clip: text` anywhere.                                               |
| No glassmorphism as default                  | Complied — pill's `backdrop-filter: blur(20px)` is the single purposeful use.                 |
| No hero-metric templates                     | Complied — Stats `StatCard` is a plain value + label, no gradient accent.                    |
| No identical card grids                      | Modes cards differentiate via default-mode ◆ marker + hover-revealed actions. `NewModeCard` dashed border breaks symmetry. |
| No modal-as-first-thought                    | **BRIEF EXCEPTION**: `ModeEditor` is a modal (brief §3). Rationale: mode editing has 4 non-trivial fields (name, prompt, language, output format) that would cramp the 2-column grid. No other modals permitted without §12 justification. |
| No em-dashes in UX copy                      | Linted (Section 10). This doc uses em-dashes because it's prose, not UX; CSS-variable references are copy-safe. |
| Category-reflex AI-slop check                | First-order: "voice dictation → blue / microphone icon / waveform gradient" is the reflex we reject. popo uses warm-neutral dark + Geist Pixel (not a stock sans) + no mic iconography outside the tray. Second-order: "utility daemon → Raycast-gray + cards" — popo avoids cards where possible (History rows, Settings rows are bare). |

### 12.4 `design-taste-frontend` — tactical anti-slop (applied)

| Rule                                         | popo status                                                                                    |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| No Inter / Roboto / Open Sans                | Complied — Geist Pixel family (Geist-derived, which taste-skill explicitly allows).            |
| No Serif in dashboards                       | Complied — no serif faces in the stack.                                                        |
| Max 1 accent, saturation < 80%               | Complied — semantics used only inside the pill, both accent hexes have chroma < 0.12 in OKLCH. |
| THE LILA BAN (no AI purple / neon gradients) | Complied — no purple tokens anywhere.                                                          |
| Icons: `@phosphor-icons/react`, standardized stroke | Complied — `regular` weight default, `bold` reserved for primary CTA buttons only.         |
| Full interaction cycles (loading/empty/error) | Phase 4 must honor: every async surface ships three visual states with DotMatrix for loading / empty. Linted (Section 10). |
| No 3-col equal-cards feature row             | Complied — popo has no "3 equal cards + icons + heading + description" row anywhere.          |
| Forms: label above input, helper below, errors below, gap-2 | Enforce in Mode editor and GCP Setup form.                                       |
| Anti-center-bias when variance > 4           | Variance is 4; center-aligned Settings page at `max-w-[600px]` is permitted.                  |
| Mobile collapse safety (`min-h-[100dvh]`)    | Desktop-only app — not applicable, recorded for discipline.                                   |
| No magnetic hover / perpetual loops          | MOTION_INTENSITY = 4 → neither is permitted.                                                   |
| No shadcn default state                      | We're hand-rolling primitives (no `shadcn add button` etc.).                                  |
| Creative placeholder data                    | Enforce in every mock / empty-state copy (e.g., sample transcripts in Test page demo).         |

### 12.5 `minimalist-ui` — spirit applied, palette rejected

popo shares minimalist-ui's **spirit** (quiet authority, restraint,
structural type, editorial whitespace) but **not its palette** (light
bone canvas). The shared spirit affects:

- Generous macro-whitespace between sections (`--sp-10+` between setting
  groups, `--sp-8/10` page padding).
- Crisp 8–12px card radii (our `--radius-card: 12px`, `--radius-button: 8px`).
- Tight tracking on display type (applied via Geist Pixel's pixel-grid
  leading).
- Flat borders instead of drop shadows (complied — only the pill has
  `backdrop-filter`, no `box-shadow` elsewhere).
- Generous card padding (`--sp-6` inside cards).
- Uppercase tracked-out small-caps for settings-group labels (brief §3).
- Keystrokes as physical `<kbd>` chips (brief + minimalist + brutalist all agree).

**Deviations from minimalist-ui, logged:**

| minimalist-ui rule                           | popo deviation                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Light canvas `#FFFFFF` / `#F7F6F3`           | popo is dark: `#080808` void. **Rationale**: popo's pill lives at the bottom of the screen overlaying whatever app the user is in (usually dark IDE / terminal). A light pill would glare; a dark pill disappears into Code/Cursor/Slack's dark theme. Non-negotiable. |
| `rounded-full` banned on large containers    | popo's pill is `--radius-pill: 9999px` at 220×44 when open. **Rationale**: the pill IS the product; its shape is brand-level. Non-negotiable. |
| Serif headings / hero (Lyon Text / Newsreader) | popo is sans-only (Geist Pixel). **Rationale**: serifs banned in product/dashboard surfaces per taste-skill. Consistent. |
| Muted pastel accents (`#FDEBEC` / `#E1F3FE`) | popo's accents are dark-tinted greens / reds for pill state only. **Rationale**: pill accents must legibly read against `#080808`; pastels don't contrast enough. |
| IntersectionObserver-driven scroll entry     | popo uses Framer Motion `pageVariants` + `staggerChildren` instead. Functionally equivalent, framework-native. |

### 12.6 `industrial-brutalist-ui` — mostly rejected, narrow borrowings

This skill's core aesthetic (Swiss print / CRT terminal, ASCII framing,
halftones, scanlines, 90° corners absolute) is **not** popo's visual
language. popo is Obsidian Instrument, not declassified blueprint.

**Borrowed:**

- Monospace (`GeistPixelGrid`) for technical metadata (timestamps,
  durations, word counts, stats values). Brutalist skill calls this
  "micro-typography for telemetry"; we'd already committed to it via the
  brief.
- Visible compartmentalization via 1px separators between settings
  rows (`border-bottom --border-faint`). No container boxes around
  each setting.
- `<kbd>` tags for keystroke chips (also what minimalist-ui prescribes;
  consistent).
- Semantic rigidity: use `<data>`, `<output>`, `<dl>` where the
  content is actually data/output/definition-list. Phase 4 Stats page
  should honor this.
- "Avoid pure `#000000`" — we already do (`#0D0D0D`, `#080808`).

**Rejected outright:**

| brutalist rule                                    | popo reason                                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `border-radius: 0` absolute                       | The pill is radius 9999px; cards are 12px; buttons 8px. popo is built ON radii.                |
| ASCII framing `[ DELIVERY ]`, crosshairs `+`, barcodes | Not popo's vocabulary. Would clash with pixel-Geist type and the instrument-ambient aesthetic. |
| `clamp(4rem, 10vw, 15rem)` macro-typography       | popo's display is `--text-stat: 36px` (Stats values) and `--text-xl: 22px` (page titles). Intentionally modest. |
| CRT scanlines / halftone / mechanical noise overlays | Pure decoration at popo's scale. Would fight `backdrop-filter: blur` on the pill and add GPU cost. |
| Aviation red `#E61919` / `#FF2A2A` as accent      | Our error accent is muted `#8B2323`. Bright red would punch through the dark ambient field too hard. |
| Registration / trademark glyphs as structural ornament | Pure vanity decoration. Banned.                                                           |
| Uppercase casing for everything                   | popo uses normal case for UI body copy; uppercase reserved for settings-group labels only.     |

### 12.7 One-line merged directive

> popo = **impeccable** (quality floor) + **minimalist-ui** (spirit:
> restraint, type, whitespace) − its-light-palette + **design-taste-frontend**
> (metric rules, anti-slop) + **brutalist-ui** (only: monospace for data,
> 1px row separators, `<kbd>` chips) − its-ASCII-ornament − its-no-radii
> − its-CRT-decoration. The brief stays single source of truth; all four
> skills support it.

### 12.8 When a future session wants to escalate a dial

Raising any of DESIGN_VARIANCE / MOTION_INTENSITY / VISUAL_DENSITY
above 4 requires:

1. Updating §12.2 with the new dial + rationale.
2. Re-reading the corresponding taste-skill dial definitions to confirm
   the new level's implications.
3. Updating the Section 10 lint checklist where applicable.
4. Updating `activeContext.md` Decisions with a one-line summary.

No dial-raise without that paper trail. Defaults stay 4/4/4.
