# POPO — System-Wide AI Dictation Tool
## Complete Development Brief v2.1

---

> **AGENT OPENING COMMAND (paste this first before this file):**
> *"You are in Builder mode. Read and fully internalize `POPO_BRIEF.md` before doing anything else — it is your single source of truth. Your very first action is to initialize the Cline Memory Bank by creating all required files in `memory-bank/` and the `.clinerules` file as specified in Section 0. Do not write any application code until the Memory Bank is initialized and Phase 1 research documents are complete."*

---

## What popo Is (Read Before Everything)

popo is a **system-level voice keyboard daemon** for Windows. It is not a transcription app, not a recorder, not a notepad. It is an invisible background service that lives in the system tray. When a global hotkey is pressed, a small floating **pill overlay** morphs open at the bottom-center of the screen, the user speaks, and on release the AI-corrected text is **automatically pasted wherever the text cursor already is** — in any app on the system: browser, VS Code, Slack, Word, terminal, anything.

The pill overlay is **always present on screen** — it never fully disappears. When idle it rests in a sleep state as a barely-there ambient element. When recording it expands and shows a live waveform. It is a **single morphing component**, never two separate components being swapped.

The **main popo window** (opened from tray) exists only for: history, settings, modes, and testing. It is secondary. The pill + auto-paste is the product.

**No mobile app in this version. Windows desktop only.**

---

## Section 0 — Cline Memory Bank Setup (Do This Absolutely First)

Before any research, before any code, the agent must establish the Memory Bank. This solves the context window exhaustion problem — every new session begins with `"follow your custom instructions"` and the agent reads these files to resume with full context.

### Create `.clinerules` in project root:

```markdown
# popo — Cline Memory Bank Rules

I am an expert software engineer building popo, a Windows system-level voice dictation tool.
My memory resets completely between sessions. I MUST read ALL memory-bank/ files at the start
of EVERY task before doing anything. This is non-negotiable.

## On Every Session Start:
1. Read memory-bank/projectbrief.md
2. Read memory-bank/productContext.md
3. Read memory-bank/systemPatterns.md
4. Read memory-bank/techContext.md
5. Read memory-bank/activeContext.md
6. Read memory-bank/progress.md
7. Only then say: "Context loaded. Continuing from: [last active task from activeContext.md]"

## Memory Bank Update Triggers:
- After completing any phase milestone
- Before context window fills (when responses slow down)
- When user says "update memory bank"
- After any architectural decision is made

## When "update memory bank" is said:
Review and update ALL six files even if some seem unchanged.
Capture: what was built, what decisions were made, what the next step is.

## Plan Mode:
Use for strategy, architecture decisions, design review.
Never start implementing in Plan Mode.

## Act Mode:
Use for writing code, creating files, running commands.
Always start Act Mode by confirming the current task from activeContext.md.

## Learned Patterns (append discoveries here as work progresses):
```

### Create `memory-bank/` with these six files (populate as work progresses):

- `projectbrief.md` — Foundation: what popo is, scope, goals
- `productContext.md` — Pill behavior, workflow, user experience goals
- `systemPatterns.md` — Rust command patterns, window management, paste mechanic decisions
- `techContext.md` — Full stack, versions, setup commands, env vars, install steps
- `activeContext.md` — Updated after every work session: current focus, last completed, next task
- `progress.md` — Phase checklist status, what works, known issues, blockers

---

## Section 1 — Design System

### Design Philosophy — "Obsidian Instrument"

popo's aesthetic is that of a **precision instrument, not a product**. It should feel like the tools that serious practitioners actually use — Raycast, Linear, Craft, Bear. Quiet authority. Nothing decorative. Everything considered. The interface makes you feel more focused when you open it, not more stimulated.

**Conceptual direction:** Dark matter. The UI is carved from darkness rather than built on top of it. Elements emerge from the void with weight and intention. Type is load-bearing structure. Spacing is as important as content. Animations are purposeful — they carry meaning, not just motion.

**Before writing any UI component, the agent must read these skill files from the project skills directory:**
- `impeccable` skill — component quality, visual hierarchy, interaction design
- `minimalist-ui` skill — editorial tone, restraint, negative space
- `industrial-brutalist-ui` skill — grid discipline, structural type
- `design-taste-frontend` skill — metric-based rules, CSS architecture

### Color Palette

```css
:root {
  /* Core surfaces — carved from darkness */
  --bg-void:        #080808;   /* Deepest layer — window background */
  --bg-base:        #0D0D0D;   /* Content area */
  --bg-surface:     #131313;   /* Cards, panels */
  --bg-elevated:    #1A1A1A;   /* Inputs, hover states */
  --bg-high:        #222222;   /* Active, selected */

  /* Text */
  --text-primary:   #EDEBE6;   /* Warm near-white */
  --text-secondary: #7A786F;   /* Muted warm gray */
  --text-ghost:     #3A3836;   /* Barely legible — disabled */

  /* Borders */
  --border-faint:   #161614;
  --border-subtle:  #202020;
  --border-default: #2C2A27;
  --border-strong:  #3D3A36;

  /* Waveform */
  --wave-primary:   #EDEBE6;   /* Active voice bars */
  --wave-flat:      #2C2A27;   /* Silence bars */

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

### Typography — Geist Pixel System

```bash
npm i geist
```

```tsx
import { GeistPixelSquare }   from 'geist/font/pixel'  // UI labels, nav, buttons
import { GeistPixelGrid }     from 'geist/font/pixel'  // Metadata, timestamps, stats
import { GeistPixelCircle }   from 'geist/font/pixel'  // Mode chips, badges
import { GeistPixelLine }     from 'geist/font/pixel'  // Transcript body text
import { GeistPixelTriangle } from 'geist/font/pixel'  // Decorative accents
```

**Assignment:**
- Navigation labels, buttons, section headings → `GeistPixelSquare`
- Timestamps, durations, word counts, stats → `GeistPixelGrid`
- Mode names, language tags, chips → `GeistPixelCircle`
- Transcript text (the reading surface) → `GeistPixelLine`
- Large display numbers in Stats → `GeistPixelSquare` at display scale

**Type scale:**
```css
--text-2xs:  9px;   --text-xs:  11px;  --text-sm:  13px;
--text-base: 15px;  --text-lg:  18px;  --text-xl:  22px;
--text-stat: 36px;
```

### Icons — Phosphor Only

```bash
npm install @phosphor-icons/react
```

Weight: `regular` everywhere. `bold` for primary CTA buttons only. Never mix with other libraries.

Key icons: `Microphone`, `MicrophoneSlash`, `ClockCounterClockwise`, `Sliders`, `Gear`, `ChartBar`, `User`, `Check`, `X`, `Warning`, `Copy`, `Play`, `Trash`, `Plus`, `CaretRight`

### Loading States — DotMatrix Only

```bash
npx shadcn@latest add @dotmatrix/dotm-square-3
```

All loading, processing, skeleton, and empty states use DotMatrix pixel dot components. Never spinner wheels, never shimmer gradients.

### Radius & Spacing

```css
--radius-pill:   9999px;  /* Overlay pill */
--radius-card:   12px;    /* Cards */
--radius-button: 8px;     /* Buttons, inputs */
--radius-badge:  6px;     /* Tags, chips */
--radius-micro:  4px;     /* Small accents */

/* 4px base unit */
--sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px;
--sp-6:24px; --sp-8:32px; --sp-10:40px; --sp-12:48px;
```

---

## Section 2 — The Pill Overlay (Most Critical Component)

### Core Principle

The pill is a **single React component** that morphs between states using Framer Motion's `layout` prop (FLIP animation). It **never unmounts, never hides, never fully disappears**. No dot indicator. No timer. No visible labels. The waveform alone communicates state — it moves with voice, stays flat in silence, and retreats to almost nothing in sleep.

### The Four States

```
SLEEP STATE              READY STATE              ACTIVE STATE
━━━━━━━━━━━━━            ━━━━━━━━━━━━━━━━━━━━━   ━━━━━━━━━━━━━━━━━━━━━
Width:  48px             Width:  220px            Width:  220px
Height: 6px              Height: 44px             Height: 44px
Opacity: 0.18            Opacity: 0.85            Opacity: 1.0

  ──────                 ┌────────────────────┐   ┌────────────────────┐
  (tiny ambient line)    │ ▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂ │   │ ▂▄▆▃▅▄▂▅▆▄▃▅▂▄▆▃ │
  barely visible         │ flat bars (silence) │   │ animated bars(voice│
                         └────────────────────┘   └────────────────────┘

Trigger:                 Trigger:                 Trigger:
Idle >4s after           Hotkey held, mic open,   PCM amplitude above
last session             no voice yet             silence threshold

PROCESSING STATE
━━━━━━━━━━━━━━━━━━━━━
Width:  180px
Height: 44px

  ┌──────────────────┐
  │  [DotMatrix ···] │
  └──────────────────┘

Trigger: audio sent to GCP
```

### State Transitions

- **Sleep → Ready** (hotkey pressed): spring morph `w:48→220, h:6→44, opacity:0.18→0.85`. `stiffness:380, damping:28`. Bars fade in (50ms delay) at flat height, color `--wave-flat`.
- **Ready → Active** (voice above threshold): no size change. Bar color `--wave-flat → --wave-primary`. Heights respond to PCM amplitude. Opacity 0.85→1.0.
- **Active → Ready** (silence): bars calm to flat, color back to `--wave-flat`. `transition: height 80ms ease-out`.
- **Recording → Processing** (hotkey released): `w:220→180`. Waveform replaced by DotMatrix.
- **Processing → Success** (paste complete): `w:180→120`, single Phosphor `Check` icon centered at 12px, color `--accent-success`. 300ms hold. Then morph back to sleep.
- **Error** (fail): `w:180`, single Phosphor `Warning` icon, border `--accent-error`. 2s hold. Then sleep.

### Waveform Spec

```
16 bars total
Bar width: 3px, gap: 2px
Total waveform width: 78px — centered in pill
Max bar height: 24px (peak voice)
Min bar height: 3px (silence / flat)
Bar color: --wave-primary when active, --wave-flat when silent
Bar border-radius: 2px top, 0 bottom
Flat state: bars at 3px with gentle ±1px organic noise for life
```

### Pill Tauri Window

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

340×80px transparent container, always open. Pill component centered inside. `WS_EX_NOACTIVATE` via `windows-rs` — never steals focus. `setIgnoreCursorEvents(true)` in sleep state, `false` when active.

### Pill Framer Motion Pattern

```tsx
// ONE component — never two
<motion.div
  layout
  animate={pillSizes[state]}  // { width, height }
  transition={{ type: 'spring', stiffness: 380, damping: 28 }}
  style={{
    borderRadius: '9999px',
    background: state === 'sleep' ? 'var(--pill-sleep-bg)' : 'var(--pill-bg)',
    border: '1px solid var(--pill-border)',
    backdropFilter: `blur(var(--pill-blur))`,
    overflow: 'hidden',
  }}
>
  <AnimatePresence mode="wait">
    {(state === 'ready' || state === 'active') && <WaveformContent key="wave" />}
    {state === 'processing' && <ProcessingContent key="proc" />}
    {state === 'success' && <SuccessContent key="ok" />}
    {state === 'error' && <ErrorContent key="err" />}
    {/* sleep: no inner content — pill shape IS the UI */}
  </AnimatePresence>
</motion.div>
```

---

## Section 3 — Main App Window Layout

### Design Direction — "The Void Dashboard"

The main app must feel like a **premium focused instrument** — not enterprise software. The standard to aim for: the feeling of opening Raycast or Linear for the first time. Every element earns its place.

**Hard rules:**
- **No dividing line between sidebar and content.** Background color difference alone creates depth.
- **No top header bar.** Frameless window (`decorations: false`). Page title floats as the first element of content — not in chrome.
- **Narrow icon-only sidebar.** 64px, icons only, labels as hover tooltips. Maximum content space.
- **Full-width rows for history** — like a music library, not a card grid.
- **Content enters with animation.** Page transitions: `y:10→0, opacity:0→1`. List items stagger at 40ms intervals.
- **Everything breathes.** Generous spacing. Sections separated by space, not lines.

### Window Config

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

Custom drag region: `data-tauri-drag-region` on top 40px of both sidebar and content area.

### Layout Structure

```
┌─────────────────────────────────────────────────────────────────┐
│ [64px sidebar]  │  [flex-1 content area]                        │
│  --bg-void      │   --bg-base                                   │
│                 │                                               │
│  [icon]         │  Page title (GeistPixelSquare --text-xl)      │
│  [icon]←active  │  Subtitle / controls row                      │
│  [icon]         │  ─────────────────────────────────────────    │
│  [icon]         │  (page content)                               │
│                 │                                               │
│  [icon]←bottom  │                                               │
│  [icon]←bottom  │                                               │
└─────────────────────────────────────────────────────────────────┘

NO border between sidebar and content.
Depth created by color alone: --bg-void vs --bg-base.
```

### Sidebar

```
Width: 64px, bg: --bg-void
Top (24px from top): popo glyph mark
  — a custom small SVG: 3 vertical bars of different heights
    suggesting a waveform. 16px wide, --text-ghost.

Nav icons (centered vertically in sidebar):
  Zone per icon: 44×44px, icon 18px Phosphor regular
  Active: bg --bg-elevated, border-radius 8px, icon --text-primary
  Inactive: icon --text-ghost
  Hover: icon --text-secondary (120ms transition)

  Tooltip on hover: floats right (8px gap)
    bg --bg-elevated, border 1px --border-subtle, radius 6px
    GeistPixelSquare 11px --text-primary, px-3 py-1.5
    Entrance: opacity 0→1, x:-4→0, 100ms ease

  Nav items (top group, vertically centered):
    ClockCounterClockwise  →  History
    Sliders                →  Modes
    Microphone             →  Test
    ChartBar               →  Stats

  Nav items (bottom, pinned to bottom):
    Gear                   →  Settings
    User                   →  Account

Bottom: version string "v0.1" GeistPixelGrid 9px --text-ghost
```

### Page Transitions (Applied to All Pages)

```tsx
const pageVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -6 },
}
const pageTransition = {
  duration: 0.18,
  ease: [0.25, 0.1, 0.25, 1]
}

// List stagger
const containerVariants = {
  animate: { transition: { staggerChildren: 0.04 } }
}
const itemVariants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.15 } }
}
```

### History Page

```
Padding: --sp-8 --sp-10

Title: "History"  GeistPixelSquare --text-xl --text-primary

Controls row (below title, mt: --sp-3):
  Left: "143 sessions"  GeistPixelGrid --text-xs --text-secondary
  Right: search input (bg --bg-elevated, borderless, rounded-full,
         placeholder "Search transcripts…" GeistPixelLine)
         + language chip filter + mode chip filter

Separator: mt --sp-6, 1px solid --border-faint

SESSION ROWS — full width, not cards:
  Height: 72px
  Padding: --sp-4 --sp-2
  Hover: bg --bg-surface (css transition 120ms ease)
  Bottom: 1px solid --border-faint

  Left side:
    Line 1: transcript preview, GeistPixelLine --text-base --text-primary
             2 lines max, truncated with fade gradient mask
    Line 2 (mt 4px): chips row
      [language chip] [mode chip]  ·  [date]  ·  [duration]
      All GeistPixelGrid --text-xs --text-secondary

  Right side (revealed on hover, opacity 0→1, 120ms):
    [Copy] [Play] [Delete]  — Phosphor icons 14px --text-secondary
    Hover each: --text-primary

  Active/selected: bg --bg-high, 2px left edge line --text-primary

Chips: GeistPixelCircle 9px, px-2 py-0.5, bg --bg-elevated, radius --radius-badge

Empty state (no history):
  Centered vertically: DotMatrix pattern (subtle)
  Below: "No sessions yet" GeistPixelSquare --text-sm --text-ghost
  Below: "Hold [Ctrl+Shift+Space] anywhere to start" GeistPixelGrid --text-xs --text-ghost

Loading: DotMatrix centered, --text-ghost
```

### Modes Page

```
Title: "Modes"  Controls row: "New Mode" button right-aligned
  Button: bg --bg-elevated, border 1px --border-subtle, radius --radius-button
          GeistPixelSquare --text-sm --text-secondary
          Hover: border --border-default, text --text-primary
          Icon: Plus 14px left of text

Mode grid: 2 columns, gap --sp-4, mt --sp-6

MODE CARD:
  bg --bg-surface, border 1px --border-subtle, radius --radius-card
  padding --sp-6, min-height 120px
  Hover: border --border-default, bg --bg-elevated (180ms ease)

  Name: GeistPixelSquare --text-base --text-primary
  Prompt preview: GeistPixelLine --text-sm --text-secondary
    3 lines, truncated, mt --sp-2
  Footer (mt auto): language chip + "47 uses" GeistPixelGrid --text-xs --text-secondary

  Default mode indicator: small ◆ glyph top-right corner,
    GeistPixelTriangle 8px --text-ghost (read-only visual marker)

  Hover reveals delete/duplicate: top-right corner icons (14px)

New Mode card:
  Same size, dashed border (border-style: dashed) --border-subtle
  Centered content: Plus 18px + "New Mode" GeistPixelSquare --text-sm --text-secondary
  Hover: border --border-default, content --text-primary

Mode Editor Modal:
  Backdrop: bg rgba(8,8,8,0.82), blur(6px)
  Panel: bg --bg-surface, border 1px --border-subtle, radius --radius-card
  Width: 520px, max-height: 90vh, padding --sp-8
  Entrance: scale 0.96→1 + opacity 0→1, 180ms ease-out

  Fields:
    Mode name (input)
    System prompt (textarea, 6 rows, font GeistPixelLine)
    Language override (dropdown, "Use default" option)
    Output format (3-option toggle: Paragraph / Bullets / Raw)

  Footer:
    "Cancel" (ghost, GeistPixelSquare --text-sm --text-secondary)
    "Save Mode" (bg --bg-high, border 1px --border-default, --text-primary)
```

### Test Page

```
Title: "Test"

Two-column layout, gap --sp-8, mt --sp-6

LEFT — Input controls:
  Microphone selector dropdown (full width, bg --bg-elevated)
  Mode selector (full width, same)
  mt --sp-6:
  "Hold to Dictate" button:
    Height 80px, full width
    bg --bg-elevated, border 1px --border-subtle, radius --radius-card
    Default: GeistPixelSquare --text-sm --text-secondary centered
    On hold: border --border-strong, bg --bg-high
    WaveformCanvas (same as pill component) appears inside on hold
    Shows flat bars → live bars as voice is detected

RIGHT — Transcript output:
  Label: "Output"  GeistPixelGrid --text-xs --text-ghost, mb --sp-2
  Output box: bg --bg-surface, border 1px --border-subtle, radius --radius-card
  padding --sp-4, min-height 200px
  Text: GeistPixelLine --text-base --text-primary
  Empty: DotMatrix + "Transcript appears here" centered, --text-ghost
  Processing: DotMatrix centered
  Footer row: word count GeistPixelGrid --text-xs --text-secondary
              + Copy button right-aligned Phosphor Copy 14px
```

### Stats Page

```
Title: "Stats"

4-metric grid top, equal columns, gap --sp-4, mt --sp-6:
  Card: bg --bg-surface, border 1px --border-subtle, radius --radius-card, padding --sp-6
  Value: GeistPixelSquare --text-stat --text-primary
  Label: GeistPixelGrid --text-xs --text-secondary, mt --sp-2
  Metrics: Total Words / Sessions / Hours / Est. Cost (USD)
  Numbers animate count-up on mount (600ms)

Language breakdown section (mt --sp-10):
  Label: "Languages"  GeistPixelSquare --text-sm --text-secondary
  Bar rows: language name (left) + bar (center, grows from 0→value on mount)
    Bar: height 4px, bg --bg-elevated fill, fill overlay --text-primary, radius 9999px
    Staggered mount animation 60ms per row
  Count right: GeistPixelGrid --text-xs --text-ghost

Weekly heatmap (mt --sp-10):
  7 columns Mon–Sun
  Each column: day label (GeistPixelGrid --text-2xs --text-ghost)
               + DotMatrix cell (opacity varies 0.1→1.0 by intensity)
```

### Settings Page

```
Title: "Settings"  Max-width: 600px (center if window wide)

SECTION GROUPS:
  Group label: GeistPixelGrid --text-xs --text-ghost uppercase letter-spacing 0.1em
  mt --sp-10 between groups

SETTING ROW:
  Height 56px, flex, align-center
  Bottom: 1px solid --border-faint
  Left: label GeistPixelSquare --text-sm --text-primary
        + optional description below: GeistPixelLine --text-xs --text-secondary
  Right: control

TOGGLE:
  36×20px, radius 9999px
  Off: bg --bg-elevated, knob --text-ghost
  On: bg --text-primary, knob --bg-void
  Knob: spring transition (stiffness:400, damping:25)
  Track: 150ms ease background

DROPDOWN: bg --bg-elevated, border 1px --border-subtle, radius --radius-input
  Open: popover below, bg --bg-surface, border --border-subtle, scroll 240px max
  Option hover: bg --bg-elevated

HOTKEY INPUT:
  Shows chips: [Ctrl] + [Shift] + [Space]
  Chips: bg --bg-elevated, border 1px --border-subtle, GeistPixelSquare --text-xs
  Click: border → --border-strong, shows "Press new shortcut…"

Groups in order:
  RECORDING — Hotkey / Mode (push-to-talk ◎ toggle ◎) / Microphone / Silence Detection
  TRANSCRIPTION — Language / Default Mode / Auto-Format with AI (toggle)
  PASTE — Paste Method (clipboard ◎ keystroke ◎) / Restore Clipboard (toggle)
  PRIVACY — Store Audio (toggle) / Privacy Mode (toggle)
  SOUND — Sound Effects (toggle)
  SYSTEM — Start at Login (toggle) / Check for Updates (button)
  GCP SETUP — Service Account JSON path (file browse) / Project ID / [Test Connection button]
  ACCOUNT — signed-in state / sign-out / sign-in with Google
```

---

## Section 4 — Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Desktop Shell | **Tauri v2** | ~14MB binary, transparent overlay |
| Frontend | **React 18 + TypeScript** | |
| Build | **Vite** | Tauri default |
| Styling | **Tailwind CSS v4** | Utility-first, zero runtime |
| Fonts | **Geist Pixel** (`npm i geist`) | Required |
| Icons | **Phosphor Icons** (`@phosphor-icons/react`) | Only — never mix |
| Animation | **Framer Motion** | Pill morph + page transitions |
| State | **Zustand** | |
| Loaders | **DotMatrix** (`@dotmatrix/dotm-square-3`) | All loading states |
| Audio Capture | **Rust `cpal` 0.15** | |
| GCP STT | **Rust `tonic` gRPC** | Chirp 3 streaming |
| Paste | **Rust `enigo` 0.2** | |
| Focus Mgmt | **Rust `windows` 0.58** | Win32 APIs |
| Clipboard | **Rust `arboard` 3** | Read + write |
| Auth | **Firebase Auth** | Google OAuth |
| DB | **Firebase Firestore** + **`rusqlite`** | Cloud + local fallback |
| Pkg Mgr | **pnpm workspaces** | Required — no npm/yarn |

### Rust `Cargo.toml`

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon", "devtools"] }
tauri-plugin-global-shortcut = "2"
tauri-plugin-notification = "2"
tauri-plugin-fs = "2"
cpal = "0.15"
tonic = "0.12"
prost = "0.13"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
enigo = "0.2"
arboard = "3"
windows = { version = "0.58", features = [
    "Win32_UI_WindowsAndMessaging",
    "Win32_Foundation",
    "Win32_UI_Accessibility",
    "Win32_System_Threading",
]}
rubato = "0.15"
gcp-auth = "0.12"
rusqlite = { version = "0.31", features = ["bundled"] }
```

---

## Section 5 — Core Dictation Flow

```
PUSH-TO-TALK:

1.  App starts → global hotkey registered (default: Ctrl+Shift+Space)
2.  Pill window created, positioned bottom-center, visible in sleep state
3.  User places text cursor in any app

4.  User HOLDS hotkey
5.  Rust: GetForegroundWindow() → store target_hwnd
6.  Rust: Read clipboard → store previous_clipboard
7.  Rust: emit "pill:state:ready" → pill morphs sleep→ready (flat waveform)
8.  Rust: setIgnoreCursorEvents(false) on pill window
9.  Rust: Start cpal audio stream → stream PCM to GCP Chirp 3 gRPC
10. Rust: Every 40ms → emit "pill:waveform" with f32[16] amplitude array
11. Pill: bars respond to amplitude (active state when above threshold)

12. User RELEASES hotkey
13. Rust: Stop audio → finalize gRPC StreamingRecognize
14. Rust: emit "pill:state:processing" → pill morphs → DotMatrix
15. GCP returns transcript

16. If auto-format enabled:
      Call Gemini Flash (gemini-1.5-flash) with transcript + mode system prompt
    Else:
      Use raw transcript

17. Rust: Write formatted text to clipboard (arboard)
18. Rust: SetForegroundWindow(target_hwnd)
19. Rust: sleep(50ms) — wait for OS focus handoff
20. Rust: enigo Ctrl+V simulation
21. Rust: sleep(100ms) — wait for paste
22. Rust: Restore previous_clipboard (arboard)
23. Rust: emit "pill:state:success" → checkmark 300ms
24. Rust: emit "pill:state:sleep" → pill morphs back
25. Rust: setIgnoreCursorEvents(true)
26. Rust (async): Save session → Firestore + SQLite

TOGGLE MODE: single hotkey press starts; second press stops. Same from step 13.

CANCEL (Escape):
  Stop audio, discard transcript, do not paste
  Restore previous_clipboard if already written
  emit "pill:state:sleep"
  Restore focus silently
```

### Paste Mechanic — Non-Negotiable

Auto-paste must always work. No user-facing fallback. Fallback hierarchy:
1. `enigo` Ctrl+V simulation (works for ~90% of apps)
2. `PostMessage(WM_PASTE, 0, 0)` to target HWND
3. `IUIAutomation::SetValueProperty` via COM
4. `AttachThreadInput` then `SendMessage(WM_PASTE)`

Document results per app category in `docs/PASTE_MECHANICS.md`.

---

## Section 6 — Project Structure

```
popo/
├── .clinerules
├── memory-bank/
│   ├── projectbrief.md
│   ├── productContext.md
│   ├── systemPatterns.md
│   ├── techContext.md
│   ├── activeContext.md
│   └── progress.md
├── apps/
│   └── desktop/
│       ├── src-tauri/
│       │   ├── src/
│       │   │   ├── main.rs
│       │   │   ├── commands/
│       │   │   │   ├── audio.rs
│       │   │   │   ├── transcribe.rs
│       │   │   │   ├── paste.rs
│       │   │   │   └── settings.rs
│       │   │   ├── audio/
│       │   │   │   ├── capture.rs
│       │   │   │   └── processor.rs
│       │   │   ├── gcp/
│       │   │   │   ├── client.rs
│       │   │   │   ├── chirp.rs
│       │   │   │   └── auth.rs
│       │   │   ├── tray/mod.rs
│       │   │   ├── hotkey/mod.rs
│       │   │   ├── focus/windows.rs
│       │   │   └── db/local.rs
│       │   ├── capabilities/
│       │   ├── Cargo.toml
│       │   └── tauri.conf.json
│       ├── src/
│       │   ├── components/
│       │   │   ├── pill/
│       │   │   │   ├── PillOverlay.tsx       ← single morphing component
│       │   │   │   └── WaveformCanvas.tsx    ← reused in Test page
│       │   │   ├── layout/
│       │   │   │   ├── Sidebar.tsx           ← 64px icon-only nav
│       │   │   │   └── AppShell.tsx          ← frameless window shell
│       │   │   ├── history/
│       │   │   │   ├── SessionRow.tsx        ← full-width row
│       │   │   │   └── HistoryList.tsx
│       │   │   ├── modes/
│       │   │   │   ├── ModeCard.tsx
│       │   │   │   ├── ModeGrid.tsx
│       │   │   │   └── ModeEditor.tsx
│       │   │   ├── settings/
│       │   │   │   ├── SettingRow.tsx
│       │   │   │   ├── SettingToggle.tsx
│       │   │   │   ├── HotkeyInput.tsx
│       │   │   │   └── GCPSetup.tsx
│       │   │   └── shared/
│       │   │       ├── Chip.tsx
│       │   │       ├── Button.tsx
│       │   │       └── Tooltip.tsx
│       │   ├── pages/
│       │   │   ├── PillPage.tsx          ← /pill route
│       │   │   ├── HistoryPage.tsx
│       │   │   ├── ModesPage.tsx
│       │   │   ├── TestPage.tsx
│       │   │   ├── StatsPage.tsx
│       │   │   └── SettingsPage.tsx
│       │   ├── hooks/
│       │   │   ├── useRecording.ts
│       │   │   ├── useWaveform.ts
│       │   │   ├── useHistory.ts
│       │   │   └── useSettings.ts
│       │   ├── store/
│       │   │   ├── pillStore.ts          ← sleep/ready/active/processing/success/error
│       │   │   ├── settingsStore.ts
│       │   │   └── historyStore.ts
│       │   ├── services/
│       │   │   ├── firebase.ts
│       │   │   ├── firestore.ts
│       │   │   └── gemini.ts
│       │   ├── types/
│       │   │   ├── session.ts
│       │   │   ├── mode.ts
│       │   │   └── settings.ts
│       │   ├── styles/
│       │   │   ├── globals.css
│       │   │   └── fonts.css
│       │   ├── App.tsx
│       │   └── main.tsx
│       ├── package.json
│       └── vite.config.ts
├── packages/
│   └── shared-types/src/index.ts
├── docs/
│   ├── COMPETITIVE_ANALYSIS.md
│   ├── TECHNICAL_SPEC.md
│   ├── PASTE_MECHANICS.md
│   └── DESIGN_SYSTEM.md
├── scripts/gen-gcp-proto.sh
├── .env.example
├── pnpm-workspace.yaml
└── README.md
```

---

## Section 7 — Firebase & GCP

### Firestore Schema

```
users/{uid}/
├── settings: { hotkey, recordingMode, language, defaultModeId,
│               autoFormat, pasteMethod, restoreClipboard,
│               soundEffects, storeAudio, privacyMode,
│               micDeviceId, silenceDetectionSeconds }
├── modes/{modeId}: { name, systemPrompt, language, outputFormat,
│                     isDefault, usageCount, createdAt }
└── sessions/{sessionId}: { createdAt, duration, wordCount, language,
                            modeId, rawTranscript, formattedTranscript,
                            audioStoragePath?, gcpCostEstimate }
```

Security Rules: `uid` paths read/write only when `request.auth.uid == uid`.

### GCP
- Speech-to-Text v2, `StreamingRecognize`, model `chirp_2` (verify model string at build time)
- `enable_automatic_punctuation: true`, `enable_word_time_offsets: true`
- Auth: user-provided service account JSON path (via GCP Setup wizard in settings)
- Post-processing: Gemini Flash `gemini-1.5-flash` with mode system prompt

### `.env.example`

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_GCP_PROJECT_ID=
```

---

## Section 8 — Feature Roadmap

### v0.1 MVP — Core Loop
- [ ] Global hotkey + push-to-talk
- [ ] Pill: sleep / ready / active / processing / success states (single component)
- [ ] Live waveform — 16 bars, PCM from Rust via Tauri events
- [ ] GCP Chirp 3 streaming
- [ ] Focus capture + restore + paste (all 4 fallback methods)
- [ ] System tray (open app / quit)
- [ ] Sound effects (ping on start, soft chime on paste)
- [ ] SQLite local history
- [ ] GCP setup wizard
- [ ] Firebase Auth (Google Sign-In)
- [ ] History + Settings pages (basic)

### v0.2 — Modes & Intelligence
- [ ] Toggle (hands-free) mode + silence auto-stop
- [ ] Default modes: Auto, Casual, Professional, Email, Code
- [ ] Gemini Flash post-processing (filler removal, punctuation, tone)
- [ ] Custom mode creator
- [ ] Quick mode switcher (second small pill above main pill on Ctrl+Shift+M)
- [ ] Word replacements / custom vocabulary

### v0.3 — Polish
- [ ] Context awareness via Win32 UIAutomation — detect active app name/window title → auto-mode select (NO screenshots ever)
- [ ] Multi-monitor support (pill on active monitor)
- [ ] Stats page with real GCP cost tracking
- [ ] History search + filters
- [ ] Export history (JSON / TXT)
- [ ] Paste mechanic tested + documented across all app categories

### v1.0 — Production
- [ ] Offline fallback: local Whisper via Rust ONNX runtime
- [ ] Auto-update via Tauri updater + GitHub Releases
- [ ] Full onboarding + first dictation tutorial
- [ ] Code-signed Windows installer (bundled WebView2 bootstrapper)
- [ ] Windows 10 + Windows 11 validated

---

## Section 9 — Testing Requirements

### Paste Mechanic Test Matrix

| App | Category | Target Method | Result |
|---|---|---|---|
| Chrome (text input) | Browser | Ctrl+V | — |
| Chrome (contenteditable) | Browser | Ctrl+V | — |
| Firefox (text input) | Browser | Ctrl+V | — |
| VS Code (editor) | IDE | Ctrl+V | — |
| Cursor (editor) | IDE | Ctrl+V | — |
| Slack (desktop) | Chat | Ctrl+V | — |
| Discord (desktop) | Chat | Ctrl+V | — |
| Microsoft Word | Office | Ctrl+V | — |
| Notepad | System | Ctrl+V | — |
| Windows Terminal | Terminal | Investigate | — |
| UAC prompt | Elevated | Expected fail | — |
| DirectX fullscreen | Game | Expected fail | — |

Document results in `docs/PASTE_MECHANICS.md`.

### Transcription Accuracy

| Test Set | Target WER |
|---|---|
| LibriSpeech clean (English) | ≤ 5% |
| Hindi | ≤ 10% |
| Telugu | ≤ 12% |
| English with Indian accent | ≤ 8% |
| Noisy (60dB background) | ≤ 18% |

### Performance Benchmarks

| Metric | Target | Maximum |
|---|---|---|
| Hotkey → pill morphs to ready | ≤ 100ms | 200ms |
| Hotkey → audio capture start | ≤ 150ms | 300ms |
| Speech end → paste at cursor | ≤ 1200ms | 2000ms |
| App cold start (tray ready) | ≤ 800ms | 1500ms |
| RAM at idle | ≤ 50MB | 80MB |
| RAM during recording | ≤ 150MB | 200MB |
| Windows installer size | ≤ 12MB | 20MB |

---

## Section 10 — Hard Constraints (Zero Exceptions)

- No Electron — Tauri v2 only
- No Flutter — React 18 + TypeScript only
- No screenshots — context via UIAutomation app name/title only, never screen capture
- No manual paste fallback — try the next technical method, never delegate to user
- No other icon libraries — Phosphor only, no Lucide, no Heroicons
- No sharp corners — every element has border-radius
- No pure black/white — use the warm palette defined above
- No other loaders — DotMatrix components only
- No other fonts — Geist Pixel family only
- No npm or yarn — pnpm workspaces only
- Pill is one component — single `motion.div` that morphs, never component swapping
- Pill never steals focus — under any circumstance from any application
- Clipboard always restored after paste
- No top header bar in main app — frameless window, page title is content
- No visible line between sidebar and content — color difference only
- No dot indicator in pill — waveform is the only UI element needed
- No timer in pill — no seconds counter, no visual clock

---

## Section 11 — Agent Execution Order

Update `memory-bank/activeContext.md` and `memory-bank/progress.md` after each step completed. At the start of every new session, say `"Reading memory bank..."` then confirm current task.

```
[0]  Initialize Memory Bank — .clinerules + all 6 memory-bank/ files
[1]  COMPETITIVE_ANALYSIS.md — research Wispr Flow, SuperWhisper, Voibe, others
[2]  TECHNICAL_SPEC.md — architecture decisions with justifications
[3]  DESIGN_SYSTEM.md — all tokens, pill state specs, component inventory
[4]  PASTE_MECHANICS.md — Win32 focus/paste implementation plan per method
[5]  Monorepo scaffold — pnpm-workspace.yaml, all directories, configs, .env.example
[6]  Rust core — cpal audio capture + GCP gRPC client + Win32 focus manager
[7]  Paste mechanic — implement all 4 methods, validate in Notepad first
[8]  Pill component — single morphing Framer Motion component + Tauri transparent window
[9]  Global hotkey → pill morph → GCP transcribe → paste (MVP end-to-end loop)
[10] Frameless main window — AppShell + Sidebar (icon-only, tooltips) + routing
[11] History page — SessionRow list with stagger animation + Firestore pagination
[12] Settings page — all settings with SettingRow pattern + persistence
[13] Modes page + ModeEditor modal + Gemini Flash integration
[14] Test page + Stats page
[15] GCP setup wizard (onboarding flow)
[16] Paste mechanic full test suite across all app categories
[17] README.md — setup guide: GCP credentials, Firebase project, first dictation
```

---

*popo is a precision instrument. The pill should feel like part of the OS — a thin membrane between voice and cursor, breathing quietly at the bottom of the screen. The main app should feel like a tool serious people use every day without thinking about it. Build it like that.*
