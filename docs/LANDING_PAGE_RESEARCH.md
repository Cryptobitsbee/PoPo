# Landing Page Research — Voice Dictation Competitors

Research date: captured live from each competitor's production landing page.
Scope: Wispr Flow, Superwhisper, Willow Voice, VoiceType. **Aqua Voice was
unreachable at research time** (DNS/TLS failure on both `aqua-voice.com` and
`www.aqua-voice.com`); include in a later pass.

Goal of this document: decide **what popo's landing page says and in what
order**, informed by what the category leaders do. This is a content /
IA / copy brief, not a visual-design spec.

---

## 1. Per-competitor breakdown

### 1.1 Wispr Flow — `wisprflow.ai`

Positioning as the flagship competitor; recently raised $81M; most polished
landing page in the category.

**Hero**
- Announcement bar (top): **"Wispr raises $81M to build the Voice OS."**
  (credibility flex before the fold)
- Headline: **"Don't type, just speak"**
- Subhead: **"The voice-to-text AI that turns speech into clear, polished
  writing in every app."**
- Primary CTA: **"Download for free"**
- Secondary CTA: **"Read the case study"** (links to Clay customer story)
- Availability strip: **"Available on Mac, Windows, iPhone, and Android"**
- Hero visual: a live before/after rendering — raw rambling transcript on
  the left, polished output on the right. Shows the product's value in one
  glance without playing a video.

**Key value props (in order presented)**
1. Speed: **"4x faster than typing"** (220 WPM vs 45 WPM keyboard comparison,
   rendered as two typing animations side by side).
2. Ubiquity: **"Write faster in all your apps, on any device"** — works
   system-wide, no integration needed.
3. Adaptability: **"Made for the way you work"** — tabbed use-case switcher
   (Teams / Students / Developers / Creators / Sales / Customer Support /
   Lawyers / Leaders / Accessibility). Each tab swaps the screenshot.
4. AI auto-edits: removes filler words, fixes grammar, reformats.
5. Cross-device sync: personal dictionary + snippets + settings sync across
   Mac / Windows / iOS / Android.

**Feature sections (order)**
1. Speed demo (keyboard vs Flow WPM counter animation).
2. Use-case tabs (9 personas).
3. AI Auto Edits.
4. Personal dictionary.
5. Snippet library (text-expander for teams).
6. 100+ languages.
7. "On-the-go or at your desk" (cross-device).

**Social proof**
- Customer logo: **"How Clay's GTM team made 20% more customer calls a day"**
  case study link in the announcement bar.
- Long testimonial wall (10+ quotes): mix of founders (Superhuman's Rahul
  Vohra, Digits' Jeff Seibert), investors (Tara Tan / Strange Ventures),
  and **an accessibility user** (Parkinson's) — deliberately diverse.
- "From typing to talking" quote card featuring **Reid Hoffman**:
  *"Voice is the future of human-computer interaction."*
- Stat cards: "90% faster everywhere" (Steven Bartlett), "20% faster GTM
  execution" (Clay), "4x faster responses" (Gaurav Vohra).

**Pricing hints**
- No pricing on landing page. Free download, "Free for 14 days" mentioned at
  closing CTA (so there IS a paid tier — just not surfaced here).
- Enterprise / Teams implied via the "Flow for Teams" and "Flow for Leaders"
  persona tabs, both mentioning SOC 2 Type II + HIPAA compliance.

**Unique / unusual elements**
- **"Still not sure that Wispr Flow is right for you?" section with three
  buttons: "Ask ChatGPT / Ask Claude / Perplexity"** — a genuinely clever
  hack that outsources objection handling to the user's own LLM.
- Uses Clay customer case study as the *opening announcement bar* rather
  than a logo wall — a single trusted narrative beats 20 faded logos.
- Persona tabs: same page, same screenshot slot, 9 persona-specific
  headlines + descriptions. Cheap segmentation, very high relevance.

**Footer**
- Standard (Company / Product / Resources columns, no special tricks).

---

### 1.2 Superwhisper — `superwhisper.com`

Mac-first, Apple-aesthetic, dev / power-user leaning.

**Hero**
- Headline: **"Just speak. Write faster."**
- Subhead: **"Turn your voice into polished text. Works in Slack, Gmail and
  any other site or app."**
- Primary CTA: **"Download"**
- Secondary CTA: **"Watch my demo"**
- Hero visual: **an in-page interactive playground**.
  "Select an app, press ⌥ + space and start dictating to try it out
  yourself!" with Cursor / Slack / Notes tabs — **the only landing page
  in this set that lets you literally try the product above the fold**.
  (There's a "Can't talk right now?" fallback text input, and a live
  scrambled-text decode animation.)

**Key value props**
1. **Adaptability** — *"Communication isn't one-size-fits-all"*. Shows the
   same spoken sentence rendered four ways: Formal / Casual / Legal / Chat.
   This is their top feature — mode switching.
2. **Works offline** (the one real differentiator vs cloud competitors).
3. **Custom vocabulary** — names, abbreviations, specialized terms.
4. **Predefined modes** — Voice / Message / Email templates.
5. **Multilanguage** — 100+ languages + translate-to-English.
6. **Clipboard auto-paste** (brags about no copy/paste friction).
7. **Meeting assistant**, file transcription, push-to-talk, shortcuts,
   "Super Mode" (screen-context-aware).

**Feature sections (order)**
1. Adaptability / mode demo.
2. Feature grid (offline, vocab, modes, multilanguage, clipboard).
3. Meeting assistant / file transcription / PTT / shortcuts / Super Mode.
4. Custom Modes editor (choose model: GPT-5 / Claude / Llama / Grok / Gemini).
5. "Works anywhere you can type" — agentic coding integration (Cursor, Claude
   Code, Open Code, Amp, Codex). Big current-moment hook.
6. iOS availability.
7. Testimonials (Karpathy, Pieter Levels, Andrew Wilkinson, Guillermo Rauch).
8. Pricing (full 3-tier table on landing).
9. Tutorial videos (6 short how-tos).
10. FAQ.

**Social proof**
- **Andrej Karpathy quote anchors the testimonial wall** — this is the
  strongest possible voice-category endorsement (his "vibe coding" tweet
  literally mentions Superwhisper by name). They use it first.
- Pieter Levels, Andrew Wilkinson, Guillermo Rauch (Vercel).
- "Used by those who move fast. From startups to industry leaders,
  hundreds of thousands rely on Superwhisper."

**Pricing (shown on landing)**
- **Free**: voice-to-text in any app, meetings, 100+ languages, unlimited
  small-model use, custom prompts.
- **Pro**: $8.49/mo (yearly) — your own API keys, unlimited cloud/local
  models, translation, file transcription, priority support. 40% off for
  students. 30-day refund.
- **Lifetime**: flagged as "Top choice".
- **Enterprise**: custom — SOC 2 Type II, centralized billing, model access
  controls, self-hosted models.

**Unique / unusual elements**
- **Try-it-in-the-hero** playground is the strongest conversion trick of
  the five. No signup, no download required.
- Pricing **is** on the landing page (contra Wispr/Willow/VoiceType).
- Model-picker bragging: they are the only one that lets you swap LLMs
  (GPT / Claude / Llama / Grok / Gemini).
- Agentic-coding section targets the Cursor/Claude-Code audience very
  deliberately. Current-moment play.
- Tutorial videos are short and task-specific (1–14 min each) rather than
  one monolithic demo video.

**FAQ**
- Free trial? ("Pro features free for 15 min, free tier forever, 30-day
  refund")
- Intel Mac support? (hints at Apple Silicon preference)
- What's next on roadmap? (public Roadmap link)
- Multi-device license? ("activate on as many devices as you like")

---

### 1.3 Willow Voice — `willowvoice.com` (YC X25)

Founder/operator-leaning, testimonial-heavy, clean single-message design.

**Hero**
- Headline: **"Stop typing. Start writing 5x faster with voice."**
- Subhead: **"AI-powered voice dictation that's so powerful it can replace
  your keyboard."**
- Primary CTA: **"Download for Free"** (Mac / Windows / iOS tabs).
- **Social-proof line right under the CTA: "Trusted by 50,000+ users"** —
  and a logo row (Instacart, 20VC, Reddit, Gusto, HubSpot, Yelp implied
  via the testimonial set).
- Hero visual: stacked email inboxes / message threads — showing the
  context the product operates in (not the product itself).

**Key value props**
1. **Speed (5x faster)** — explicit in the headline.
2. **Keyboard replacement** — framed as total, not partial.
3. **Social proof first** — 50k users + founder logos land in the first
   scroll.
4. **Three-step how-it-works**: *"1. Press a hotkey. 2. Speak naturally.
   3. Perfect text appears."* Very popo-relevant.
5. **Audience targeting**: "**The Most productive [Leaders / Developers /
   Founders / Students / Professionals / Writers] Use Willow**" — rotating
   word animation.

**Feature sections (order)**
1. Hero + testimonial above the fold.
2. Problem statement: *"Your Keyboard Is Slowing You Down"*.
3. Meet Willow (how-it-works, 3 steps).
4. Rotating-audience headline + testimonial marquee.
5. Feature cards — Automatic editing/formatting, Style-matching, Context
   awareness (names + unique terms), AI Mode (one phrase → full message).
6. Smaller feature cards — **Whispering** (softly/whisper detection),
   **Privacy** (SOC 2, HIPAA, zero data retention, privacy mode), **Voice
   commands** ("dash" / "new line" / "bullet point"), **Works anywhere /
   any language**.
7. Willow-vs-others comparison table (marketing vs a generic "Not
   intelligent / misses context / robotic / no formatting" competitor).
8. FAQ.
9. X/Twitter testimonial wall (marquee, ~10 tweets).
10. Final CTA.

**Social proof**
- **50,000+ users** stat in hero.
- Logo row: Instacart, Yelp, 20VC, HubSpot, Reddit (Alexis Ohanian), Gusto,
  Origin.
- **Alexis Ohanian quote**: *"For decades I've wanted to just talk to my
  computer and have it work. Willow is the first time it actually did —
  and it's delightful."* (strong hero-adjacent quote).
- Twitter marquee (vertically scrolling).

**Pricing hints**
- No pricing on landing. Julien Codorniou's testimonial leaks that it's
  **$15/month**.

**Unique / unusual elements**
- **Rotating-audience headline** (Leaders / Developers / Founders / …) —
  light, cheap, gives every persona a "that's me" moment.
- **Explicit keyboard-replacement framing**: "Stop typing" / "replace your
  keyboard". Bolder than Wispr's "don't type, just speak" because it
  commits to the totality.
- **Willow-vs-other comparison table**: left column = Willow features,
  right column = generic "Not intelligent / misses context / robotic /
  no formatting / misses tone". Doesn't name competitors but signals a
  category upgrade.
- **Whispering / background-noise** as a named feature is distinctive —
  addresses the real-world "I'm in a meeting, I can't shout" objection.

**FAQ (short)**
- Free? (yes, no credit card)
- Secure / private? (SOC 2, HIPAA, zero retention)
- Languages beyond English? (yes)

**Footer**
- Home / Manifesto / Pricing / Blog / Case Studies / Use Cases / Download
  / Careers. (They have a "Manifesto" link — a touch that borrows from
  Linear/Things.)

---

### 1.4 VoiceType — `voicetype.com`

More conversion-optimized / "indie hacker" style. Heavy on stats.

**Hero**
- Headline: **"Write 9x Faster with AI Voice-to-Text"** (bigger multiplier
  than anyone else — 9x vs everyone's 4-5x).
- Feature bullets right in the hero:
  - *Write 360 words per minute*
  - *Works across all your apps*
  - *99.7% accuracy score*
  - *Auto-formats & improves your writing*
- Primary CTA: **"Try for Free"**
- Social-proof line: **"Join 65,000+ VoiceTypers"**.
- Hero visual: a literal **giant Mac keyboard illustration with notes
  floating above it** — "Notes / Scaling your Business 101" — shows a
  live dictation filling a page.

**Key value props**
1. Raw speed: **9x faster / 360 WPM / 99.7% accuracy** — the whole hero
   is numbers.
2. **User count** (65k VoiceTypers) repeated 3+ times on page.
3. "Trusted by doctors, lawyers, journalists, founders, and more" —
   profession-by-profession credibility.
4. Auto-formatting + style adaptation.
5. ROI calculator (calculates $ saved per month based on typing hours).

**Feature sections (order)**
1. Hero with stats.
2. "Trusted by doctors, lawyers, journalists, founders…" logo / avatar row.
3. WPM battle: 40 WPM keyboard vs 360 WPM VoiceType.
4. **"See how VoiceType out-performs other dictation tools"** — before/after
   comparison: rambling filler-word transcript on the left, clean formatted
   email on the right. Callouts: auto-formatting, context-aware, sounds
   like you, improves your writing.
5. **"Works across every application"** — app logos grid.
6. **"When People use VoiceType"** — 8 use-cases (Writing Emails,
   Self-Reflection, Meeting Summaries, Requirements Mapping, Journaling,
   Day Planning, Project Documentation, Note Taking).
7. Testimonial row (plain text, not Twitter screenshots).
8. **"I wrote 63,470 words with VoiceType this week"** — pull quote
   hero-sized. Smart because it's a specific number.
9. **ROI calculator** — "Calculate how much you save with VoiceType"
   (slider + $/hr input → calculated monthly savings). **Unique to
   VoiceType in this set.**
10. **Tone Match section** — shows the same underlying thought rendered
    in 6 different app contexts (Slack, Instagram, recruiting email,
    iMessage to mom, Linear issue, AI copilot prompt).
11. Feature cards (Private & Secure, 35+ languages, Whisper Mode, Context
    Aware).
12. More testimonials.

**Social proof**
- 65,000+ users stat.
- Avatar/logo row (doctors, lawyers, journalists, founders).
- User-generated numbers: "I wrote 63,470 words with VoiceType this week"
  — a single user's weekly stat as a giant pull quote.

**Pricing hints**
- No pricing table on landing, but ROI calculator mentions
  **"VoiceType monthly cost (yearly plan) $13"** — so ~$13/mo yearly.

**Unique / unusual elements**
- **ROI calculator** — inputs words/day + $/hr, outputs monthly $ saved.
  This is a very B2B-SaaS move and it's aggressive.
- **Tone Match** section literally shows 6 different output tones for
  different apps side-by-side, with specific convincing example copy for
  each (Slack to colleagues, Instagram to best friend, recruiting email,
  iMessage to mom, Linear issue, AI copilot prompt). This is the *best*
  tone-adaptation demo of any of the four pages.
- Uses the **ADHD testimonial** ("my mind processes many more thoughts
  than the usual mind") — niche-audience signal that they've thought
  about accessibility beyond Parkinson's.
- All hero bullets are **measurable numbers** (360 WPM, 99.7%, 9x, 65k) —
  goes harder on quantification than anyone else.

---

## 2. Synthesis — the must-haves

These content sections appear in **every** landing page in the research set
(4 of 4). If popo's landing page omits any of these, it's undershooting
category norms.

1. **A one-sentence speed claim in the hero headline.**
   Verbs: "Don't type" / "Stop typing" / "Just speak". Numbers: 4x, 5x, 9x.
   Popo's version should pick a lane (we have both speed AND the "system-wide
   that *actually* works on Windows" story; speed is the category cost of
   entry, so lead with it, differentiate below).
2. **A big visible Download CTA** at the top, repeated 3–5× down the page.
   All four use "Download for Free" or "Try for Free". Signup-walls are
   absent from the category.
3. **Availability line under the hero CTA** ("Available on Mac, Windows,
   iPhone…"). For popo, this is literally just "Windows" — which we can
   turn into a *feature*, not an apology (see §5 below).
4. **A before/after transcript demo** — rambling input on the left,
   polished output on the right. Wispr, Willow, VoiceType all do this.
   Single strongest visual trope in the category.
5. **A WPM / speed comparison** — keyboard vs voice, rendered as two
   animations or bar charts. Wispr and VoiceType both do this.
6. **A logo / stat strip** — either "X,000+ users" or named-customer logos
   or both. Immediate trust signal near the hero.
7. **Use-case / persona section** — 6–9 audiences (developers / lawyers /
   sales / students / teams / accessibility / creators / support). Either
   as tabs (Wispr) or cards (Willow) or a rotating word (Willow's
   "The Most productive __ Use Willow").
8. **Feature grid of 4–8 tiles.** Every page has one. Standard tiles:
   auto-formatting, works anywhere, 100+ languages, custom vocabulary,
   privacy/security, voice commands.
9. **Testimonial wall** — minimum 6 quotes, ideally as Twitter/X cards
   (Willow, VoiceType) or a horizontal marquee (Superwhisper).
10. **Final repeat-CTA footer section** — headline + subhead + Download
    button, usually echoing the hero's copy.
11. **FAQ** (3–6 questions). At minimum: free?, privacy?, languages?.
12. **"Works anywhere you type"** section — app logo cloud
    (Slack, Gmail, Notion, Cursor, VS Code, etc.). Anchors the
    "system-wide" claim visually.

---

## 3. Hooks that resonate (what copy to steal)

Phrases that earned position in the hero or just below — these are the
voice-dictation category's dominant hooks:

- **"Don't type, just speak"** (Wispr Flow)
- **"Stop typing. Start writing 5x faster with voice."** (Willow)
- **"Just speak. Write faster."** (Superwhisper)
- **"Write 9x Faster with AI Voice-to-Text"** (VoiceType)

**Pattern**: `imperative verb + negation of typing + speed multiplier`.

Strong sub-patterns to borrow:
- **"Speak at the speed of thought"** / "at the speed of thought" — Wispr
  uses variants.
- **"Turns speech into polished text"** — present in 3/4 pages. *Polished*
  is the category keyword; *transcription* is not. Users don't want a
  transcript, they want a finished message.
- **"Works in every app"** / "Works anywhere you type" — the ubiquity claim
  is table-stakes; needs to appear somewhere in the first 30 words.
- **"It can replace your keyboard"** (Willow) — strongest totality framing;
  more aspirational than "faster".
- **"[X] faster than typing"** with a specific number — 4x / 5x / 9x all
  used. Popo should pick a number it can defend.

Anti-patterns (absent from all four; avoid):
- "Transcription" / "Speech-to-text" as hero words. Too utility-flavored.
- "Powered by [foundation model name]". Users don't care.
- "Accurate" as a headline word (only VoiceType uses "99.7% accuracy" and
  it's a sub-bullet, not the headline).
- Any mention of "AI" before "voice" — hero hierarchies put voice first.

---

## 4. Unique differentiators (each plays up one angle)

| Competitor     | One-line differentiator on the landing page                     |
|---------------|-----------------------------------------------------------------|
| Wispr Flow    | Cross-device (Mac+Win+iOS+Android) + $81M funded credibility    |
| Superwhisper  | **Offline + pick-your-own LLM** + agentic-coding hook           |
| Willow Voice  | Keyboard-replacement totality + 50k user social proof + whisper |
| VoiceType     | **Numbers-heavy** (9x, 360 WPM, 99.7%, 65k users) + ROI calc    |

Patterns worth noting:
- **Superwhisper** is the only one that brags about being **offline**.
  For a privacy-conscious Windows user this matters; popo's
  bring-your-own-GCP is adjacent (not offline, but user-controlled cloud).
- **VoiceType** is the only one with a **ROI calculator**. Nobody else
  bothers — it reads as indie-hacker-y but measurably converts.
- **Willow** is the only one with an explicit **"whispering" feature** —
  addresses the social-space usability objection directly.
- **Wispr** is the only one that uses the **"Ask ChatGPT / Claude /
  Perplexity about us"** section — an LLM-era marketing primitive worth
  borrowing.

---

## 5. Gaps in the category — what popo can lean into

Things **none** of the four pages talk about. These are popo's openings.

1. **"Bring your own Google Cloud"**.
   Every competitor hides the backend (black-box cloud or mysterious
   "private servers"). Popo's BYOK model is a genuine category-first
   story — users pay Google directly, popo takes a 0% cut of per-minute
   cost, and transcripts go straight from user → Google → user. Frame
   as: *"Your voice, your cloud, your bill."*
2. **"Windows-first, Windows-only"**.
   Every competitor is Mac-first with Windows as a port. We can own the
   Windows position outright: *"Built for Windows from day one. Not a Mac
   port."* — or similar.
3. **Transparent per-use cost**.
   Nobody shows the math. Willow is $15/mo, Superwhisper is $8.49/mo,
   VoiceType is ~$13/mo. Popo's Chirp cost is literally ~$0.016/min.
   A typical heavy user at 30 min/day = $14/mo to Google, $0 to popo.
   **"We don't mark up your transcription. Your first 60 min/month
   are free from Google."** This is a genuine differentiator — nobody
   in the category competes on cost transparency.
4. **Local session history / WAVs**.
   Every competitor has session history; none mention where it lives.
   Popo stores WAVs locally in `%APPDATA%\popo` and Firestore syncs only
   metadata. Frame as: *"Your audio never leaves your machine unless
   you sign in."*
5. **Open modes / custom prompts that stay yours**.
   Superwhisper lets you pick a model; none let you ship a mode someone
   else wrote. Popo's mode system is currently user-local but could ship
   a mode library. Post-v0.1 though.
6. **Paste reliability — "it works in every app"**.
   Willow/VoiceType hand-wave the "works anywhere" claim. Popo's
   4-method paste fallback chain + app-icon-in-pill acknowledgement
   is a demonstrable proof of reliability that no one else shows.
   A literal grid of tested apps with ✓/✗ status would be the category's
   first honest reliability page.
7. **"No account required to use"**.
   All four funnel through some kind of signup/download. Popo works
   standalone after the GCP setup wizard. Sign-in only adds history sync.
   *"Download, set up GCP, done. No popo account needed."*
8. **The setup wizard as a feature, not a chore**.
   All four hide the credentialing (black-box cloud). Popo has a 5-step
   GCP wizard. Frame this honestly as the one-time tradeoff for the
   privacy/cost model. "60 seconds of setup, then it's yours forever."
9. **Open-source adjacent / user-inspectable**.
   None of the four mention being inspectable. Popo's Rust core can be
   opened up. (Direction is a product decision, but *if* we go
   source-available, nobody else in the category does.)

---

## 6. Proposed section order for popo's landing page

Synthesized from the must-haves in §2 + popo's differentiators in §5.
Each section is one "scroll-stop" unit.

1. **Nav bar** — logo, "Download", "Pricing" (transparent link to the cost
   model), optional "GitHub" if we go source-available.
2. **Hero**
   - Headline: a speed-claim variant (TBD copy; see §3 patterns).
   - Subhead: one sentence that says "system-wide Windows dictation,
     your Google Cloud, your cost."
   - Primary CTA: **Download for Windows** (with tiny version tag).
   - Secondary CTA: **See the 90-second demo** (inline video modal).
   - Availability line: *"Windows 10/11 · x64"* (own the focus).
   - Hero visual: before/after transcript rendered side by side
     (rambling → polished).
3. **Speed proof** — a literal WPM counter animation (keyboard vs popo),
   60 vs 220+ WPM, following the Wispr pattern. One stat per side,
   no chart clutter.
4. **How it works — 3 steps** — hotkey → speak → text appears at cursor.
   Use Willow's pattern. Include the popo pill as the *visual*.
5. **"Works in every app you already use"** — logo cloud: Slack, Gmail,
   Notion, Cursor, VS Code, Chrome, Figma, Linear, Obsidian, Arc, Teams,
   Outlook, Word. Ground the system-wide claim.
6. **Modes demo** — same spoken input rendered as Email / Slack / Code
   comment / Professional / Casual. Steal VoiceType's "Tone Match"
   section outright — it's the best execution of this idea.
7. **The differentiator section ("Why popo is different")** — three
   side-by-side cards:
   - *Your cloud, your bill.* (BYOK Google, no per-minute markup)
   - *Your audio stays local.* (WAVs never leave your machine unsigned-in)
   - *Built for Windows.* (Not a Mac port; native Win32 paste.)
   This is where popo breaks from the category. Don't bury it.
8. **Feature grid (6 tiles)** — Auto-format with modes / 100+ languages /
   Custom vocabulary / Whisper-volume support / 4-method paste fallback
   (rename to "Works in every text field") / Optional cloud sync.
9. **Pricing** — a clean 3-row comparison:
   - **popo**: Free forever. You pay Google directly (~$0.016/min,
     first 60 min/month free).
   - **Wispr Flow**: $12/mo flat (example).
   - **Willow / Superwhisper**: $8–15/mo flat.
   A typical-user calculator widget (à la VoiceType's ROI calc) that
   instead computes "what you'd pay on each tool for your usage" would
   be cheeky and on-brand. Only tool where heavy usage = same cost per
   minute; light usage = $0.
10. **Trust / privacy line** — short: "Audio: local only. Transcript:
    Google Chirp (your credentials). Optional sync: your Firebase
    project. No popo-owned server ever sees your data."
11. **Testimonials** — will need to seed with early users / friendly
    founders. Target the Windows power-user audience specifically since
    everyone else targets Mac creators.
12. **FAQ** — at minimum:
    - Why do I need a Google Cloud account?
    - How much does it actually cost me?
    - Does popo see my audio / transcripts?
    - Does it work offline? (Honest answer: no — but audio stays local
      when you're offline; sync catches up later.)
    - What apps does paste reliably work in? (link to the matrix)
    - Mac / iOS / Android plans? (honest: no.)
13. **Final CTA** — Download for Windows, echo hero headline.
14. **Footer** — GitHub / docs / privacy / terms / changelog / status.

---

## 7. Clever UI patterns worth borrowing

Ranked by effort-to-impact ratio.

1. **Before/after transcript split** (Wispr, VoiceType, Willow).
   Single best pattern in the category. Do this.
2. **Inline try-it playground** (Superwhisper).
   Highest conversion lift of the research set. Hardest to build —
   requires a sandboxed transcription path without download. A
   **pre-recorded** version ("press play to hear what popo would
   transcribe") is a lower-effort variant.
3. **WPM race animation** (Wispr keyboard vs Flow counter).
   Easy to build, universally legible, works without audio.
4. **Persona tabs** (Wispr's Teams/Students/Devs/Creators switcher).
   Same screenshot slot, 6–9 headlines. Cheap, high-relevance.
5. **Rotating-audience headline** (Willow's "The Most productive __
   Use Willow"). Framer/GSAP word rotator. 30 minutes of work.
6. **"Ask ChatGPT about us" buttons** (Wispr). 3 buttons, each
   deep-links an LLM with a preloaded prompt. Zero infra.
7. **ROI / pricing calculator** (VoiceType). Slider + input → computed
   $. Doubles as the honest-pricing differentiator (§5).
8. **Twitter/X testimonial marquee** (Willow, Superwhisper, VoiceType).
   Pure visual richness. Requires real tweets — seed from beta users.
9. **Tone-match grid** (VoiceType's 6-app tone demo).
   Explicit "same thought → 6 outputs" grid. Popo's modes system maps
   1:1 onto this; we can ship this section using real popo output.
10. **App-icon-in-pill in the demo video**. Popo already does this —
    record the pill dictating into 6 different apps and splice. None
    of the four competitors demo the per-app context awareness, so
    this is visually novel in the category.

---

## 8. Recommended copy directions for popo's hero (options)

Three directions, each defending a different differentiator. Pick one.

**A. Speed + Windows claim (most conservative):**
- H1: **"Talk. Your words appear. Anywhere on Windows."**
- Sub: The voice dictation that actually works in every Windows app —
  3x faster than typing, and you own the cloud bill.

**B. BYOK / cost story (most differentiated):**
- H1: **"Voice dictation at cost."**
- Sub: popo turns your voice into polished text in any Windows app,
  using your own Google Cloud. No markup, no subscription, no popo
  server in the middle.

**C. Windows-first / positioning against Mac competitors (most pointed):**
- H1: **"Finally, voice dictation built for Windows."**
- Sub: Hold a hotkey, speak, and clean text lands at your cursor —
  in Slack, Outlook, VS Code, everywhere. Your audio stays on your
  machine. Your transcription runs on your Google Cloud.

(D) is a hybrid: lead with Windows in the eyebrow, speed in the H1,
BYOK in the sub. Probably the strongest single frame given our
differentiators, but needs to be tested as copy.

---

## 9. Open items

- **Re-fetch Aqua Voice** (aqua-voice.com) when their DNS is back.
  It's known to be the other main Windows-friendly competitor and
  should be folded into §1 and §4.
- **Pricing page mock**: popo's pricing story deserves its own page
  (linked from the landing nav). A cost calculator with real Chirp
  numbers is the move.
- **Paste matrix page**: a public grid of tested apps with ✓/✗ /
  "works with fallback" — category-first reliability flex; zero
  competitor does this.
- **Copy decisions**: H1 direction (§8 A/B/C), WPM multiplier number
  we're willing to defend (3x? 4x?), primary CTA label ("Download for
  Windows" vs "Try popo free").
