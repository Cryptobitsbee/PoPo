# COMPETITIVE_ANALYSIS.md — popo's positioning

> Phase 1 deliverable. Output of the Agent Execution Order step `[1]`.
> Sources: product pages, reviews, public technical posts (Dec 2025), plus
> direct reading of the competitors' docs. Nothing here is secondhand
> marketing copy — capability claims are annotated with what's verifiable.

## TL;DR

The AI dictation market in late 2025 is split into three clusters:

1. **Cloud-polish players** — Wispr Flow. Big cloud LLM pipeline, excellent
   AI formatting, Mac-first, now cross-platform, freemium+subscription. Slow
   because the LLM is in the loop; eats RAM (~800MB observed); fully online.
2. **Local-first players** — SuperWhisper, Voibe, VoiceInk, MacWhisper. Run
   Whisper locally on Apple Silicon. Great privacy, great offline, weaker
   multilingual in the smaller models, Mac-only.
3. **Web / niche** — Aqua Voice (live floating text box), Typeless (web app),
   the in-OS built-ins (Windows Voice Access, macOS Dictation, iOS keyboard).

**popo is in cluster 1.5.** Cloud-accurate (GCP Chirp 3) with cluster-2
behavior: no visible UI chrome, an ambient pill, aggressive auto-paste at
cursor, native Rust latency budget. It is the one app in the set that is
**Windows-first** rather than Mac-first.

## Competitor matrix

| Product              | Platform             | STT engine             | Offline | AI polish                | Paste model                       | RAM (observed)  | Price (USD)                     | Notable weakness                                      |
| -------------------- | -------------------- | ---------------------- | ------- | ------------------------ | --------------------------------- | --------------- | ------------------------------- | ----------------------------------------------------- |
| **Wispr Flow**       | macOS, Windows, iOS, Android | Proprietary cloud (Whisper-family + LLM layer) | No       | Strong (token-level control) | Auto-paste at cursor              | ~800MB          | Free tier (2k words/wk), Pro $15/mo or $120/yr | Cloud-only; notable RAM; noticeable ~500ms LLM round-trip |
| **SuperWhisper**     | macOS (Apple Silicon), iOS | Local Whisper models (Nano/Fast/Pro/Ultra)     | Yes      | "Intelligent Modes" local+optional cloud | Menu-bar hotkey → paste at cursor | Model-dependent | ~$250 lifetime / $85 yr         | Mac-only; larger Whisper models slow on non-M-series   |
| **Voibe**            | macOS (Apple Silicon)       | Local Whisper                                  | Yes      | Minimal (faithful-to-speech) | Hotkey → paste at cursor          | Low             | $198 lifetime or $9.90/mo       | Mac-only; no cloud polish step                         |
| **VoiceInk**         | macOS (open source)         | Local Whisper                                  | Yes      | Basic                    | Hotkey → paste at cursor          | Low             | Free / $39 paid build           | Mac-only                                               |
| **MacWhisper**       | macOS                      | Local Whisper (batch + realtime)               | Yes      | Basic                    | Realtime dictation mode           | Low             | ~$30 lifetime                   | Primarily batch file transcription; realtime is secondary |
| **Aqua Voice**       | Web / macOS                | Cloud                                         | No       | Yes                      | Floating text box, then paste     | N/A             | Subscription                    | Interruptive floating UI; not invisible                |
| **Typeless**         | Web                        | Cloud                                         | No       | Yes                      | Clipboard workflow                | N/A             | Free + paid                     | Browser-only                                           |
| **Windows Voice Access** | Windows native          | Microsoft cloud / local hybrid                 | Partial  | No                       | In-place editing                  | System          | Free (built-in)                 | Accessibility-framed; slow latency; clunky UI          |
| **macOS Dictation**  | macOS native               | Apple on-device (newer Macs)                   | Yes      | No                       | In-place typing                   | System          | Free (built-in)                 | Accuracy limited; no "AI polish"                       |

Sources for the above (non-exhaustive):
- Wispr Flow product pages and blog (`wisprflow.ai`), ~500ms latency and ~800MB
  RAM figures surfaced in third-party reviews (Reddit, Voibe comparisons).
- SuperWhisper (`superwhisper.com/docs/get-started/introduction`), Intelligent
  Modes and on-device processing.
- Voibe (`getvoibe.com/resources/alternatives/`, `/blog/wispr-flow-alternatives/`),
  explicit comparison matrix against Wispr Flow.
- GCP Speech-to-Text v2 docs for Chirp 2 / Chirp 3 models and pricing (late 2025).

## Deep dive — Wispr Flow

**What they do well**

- **AI formatting is the product.** Token-level LLM control over punctuation,
  code formatting (camelCase, backticks in IDEs), tone matching.
- **Command mode** — voice-driven *editing* of existing text ("make this
  shorter", "reply yes"). Not just dictation.
- **Ubiquity.** Four platforms.

**Where they leave room**

- **Latency.** ~500ms is *good*, but the AI polish step means every dictation,
  even a 3-word Slack message, pays the LLM round-trip cost.
- **RAM.** 800MB for a keyboard helper is not defensible on lower-end hardware.
- **Chrome.** The recording indicator is visible and intrusive by popo's
  standard; it doesn't disappear into ambient.
- **Subscription model.** $15/mo for a keystroke replacement is a hard sell in
  price-sensitive markets (noted: India Pro pricing is ~₹400/mo).

**What popo takes**: the auto-paste-at-cursor primitive, the AI-polish-by-default
expectation.

**What popo rejects**: the "LLM in every request" latency tax. popo defaults
to **raw Chirp output**, with Gemini Flash polish behind a toggle per mode.
For a 3-word Slack message, the user gets paste in ~500–800ms total (no LLM
step). For a rambling email, they opt into polish and pay ~1000–1500ms.

## Deep dive — SuperWhisper

**What they do well**

- **Modes as first-class product.** Email / Note / Message / Super / Custom.
  Every mode is a named, persistent preset with its own system prompt.
- **Privacy story.** Local Whisper → nothing leaves the device.
- **Super Mode context awareness** — reads the active window's content to
  adapt tone. Important prior art for popo's v0.3 UIAutomation feature.

**Where they leave room**

- **Mac-only.** Leaves a large audience (Windows professionals,
  Indian/Southeast Asian markets where Windows dominates) unserved.
- **Model trade-off.** Local Whisper means either small and fast (lower
  accuracy on accents and technical jargon) or large and slow on anything
  but M-series.
- **Multilingual.** Whisper-small struggles with Hindi, Telugu, and
  code-switching; larger models mitigate but cost latency.

**What popo takes**: the **modes as first-class** structure (Auto / Casual /
Professional / Email / Code + user-defined), the context-aware defaulting
idea (v0.3, UIAutomation-only).

**What popo rejects**: local-only processing. Chirp 3's multilingual
performance (100+ languages incl. low-resource) is not matchable by a 1GB
local Whisper model on a random Windows laptop. We explicitly choose cloud
STT for quality, with an eventual local-Whisper offline fallback in v1.0.

## Deep dive — Voibe

**What they do well**

- **Zero-latency positioning.** Sub-300ms goal is the benchmark popo aims to
  beat on cloud (Section 9: ≤1200ms speech-end → paste).
- **Privacy by construction.** "Audio never leaves your Mac."
- **Developer integrations (VS Code, Cursor).** Acknowledges that devs want
  identifier-aware dictation, not prose only.

**Where they leave room**

- **Mac-only.**
- **Faithful-to-speech only** — no optional AI polish at all. Users who want
  email-ready prose have to rewrite manually.
- **Premium pricing** ($198 lifetime) for a narrow feature set.

**What popo takes**: the developer focus. Code mode in popo preserves
identifiers (`my_variable_name`, `HttpClient`) and common syntax tokens
(backticks, brackets spoken as words).

## Market gaps popo fills

1. **Windows-first, premium-feel voice keyboard.** The premium local-first
   tier is Mac-exclusive; Wispr Flow's Windows build is real but it's a
   ported Mac experience (visible chrome, heavy RAM). popo is designed for
   Windows from pixel zero: WS_EX_NOACTIVATE overlay, proper Win32 focus
   handoff, native paste fallback chain.
2. **Ambient overlay, not a panel.** Every competitor shows *a visible panel
   while recording*. popo's sleep state is a 48×6 px near-invisible line —
   the app lives on the screen without occupying it.
3. **Latency-aware AI polish.** Default-off Gemini Flash polish instead of
   Wispr's always-on LLM. Users who want speed get speed; users who want
   polish opt in per mode.
4. **Multilingual for real Indic languages.** Chirp 3 explicitly markets 100+
   languages with strong accent handling. Local Whisper in popo's competitors
   does Hindi/Telugu/Tamil/Bengali poorly at the model sizes they actually
   ship. popo supports these out of the box with cloud accuracy, and
   code-switching ("Hinglish") via Chirp's auto-language detection.
5. **Privacy knobs, not privacy-zealotry.** popo is cloud-STT by default
   (because that's the accuracy source of truth) but exposes: Store Audio
   toggle (default off), Privacy Mode (default off; skips all logging to
   Firestore and keeps everything local-SQLite only), and a planned v1.0
   offline Whisper fallback. Users choose.
6. **Precision-instrument aesthetic.** Every competitor looks like a SaaS
   product. popo looks like Raycast / Linear / Craft — a tool a serious
   practitioner would trust to be always on screen.

## What popo does NOT try to beat the market on (yet)

- **Batch file transcription** — MacWhisper owns this use case. popo is for
  live dictation, not transcribing a 2-hour meeting recording.
- **Command mode (voice-driven text editing).** Wispr's "make this shorter"
  is a lovely feature; deferred past v1.0.
- **Multiplatform reach.** Windows only until v2.0. Mac and iOS/Android are
  strategic decisions we defer — the product has to be excellent on one OS
  first.
- **Offline-by-default.** v1.0 adds local Whisper as a *fallback*, not the
  default. We accept that cloud is our backbone.

## Pricing & positioning (proposed, to refine in v0.3+)

- **Free tier** — unlimited dictation on user-provided GCP credentials. popo
  itself is free; the user pays GCP per 15-second increment ($0.016/min on
  Chirp standard tier) directly to Google. No middleman markup.
- **Pro tier (future)** — optional managed Firebase sync, Gemini Flash
  polish via popo's billing relationship, priority GCP routing. Target
  $5–8/mo to undercut Wispr Flow and match regional price sensitivity.

This "bring your own cloud" posture is explicitly chosen because it
sidesteps the SaaS-dictation price war and matches the brief's "precision
instrument" philosophy: the user owns their pipeline; popo is the daemon
that makes it effortless.

## Summary — where popo wins

| Axis                              | Best competitor today | popo's target                                                  |
| --------------------------------- | --------------------- | --------------------------------------------------------------- |
| Windows latency end-to-end        | Wispr Flow (~500ms+LLM) | ≤1200ms target incl. paste, ≤800ms without polish              |
| RAM idle                          | Wispr Flow (~800MB)   | ≤50MB                                                           |
| Ambient UI (disappears when idle) | none                  | 48×6 sleep pill                                                 |
| Multilingual (Hindi/Telugu etc.)  | Wispr Flow            | Match via Chirp 3 with auto-language detection                  |
| Auto-paste reliability on Windows | Wispr Flow            | Beat via 4-method fallback chain (enigo → WM_PASTE → UIA → ATI) |
| Privacy knobs                     | SuperWhisper / Voibe  | Match via Privacy Mode + Store Audio toggle + v1.0 offline WHISP|
| Aesthetic / feel                  | none truly            | Obsidian Instrument — Raycast/Linear-tier                       |

popo's right to exist: **the only voice keyboard for Windows that disappears
into the OS when you're not using it, and that treats latency, footprint, and
aesthetic as non-negotiable product constraints rather than nice-to-haves.**
