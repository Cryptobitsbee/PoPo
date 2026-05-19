# popo v0.2 — Feature Roadmap

> **Last updated**: Session 49 (this turn)
> **Source**: `chat-feature-suggestions` synthesis. User-selected 12 features
> for next-quarter implementation, ranked by phase.

This doc is the implementation playbook for popo's v0.2 feature set. Each
feature has enough detail that a future engineer (or future-self) can
pick it up and start building without redoing design work. Specs include:

- **What**: user-visible behavior
- **Why**: who benefits, what problem it solves
- **Files**: every file that needs touching (Rust + React)
- **Data model**: shared-types / settings / Firestore schema changes
- **Algorithm**: logic flow, edge cases
- **UI**: components, copy, interaction patterns
- **Effort**: rough days estimate
- **Dependencies**: what blocks this / what this blocks
- **Validation**: how to verify it works end-to-end

When implementing, **always** update the `Status` line of the feature to
one of: `Not started` / `In progress` / `Shipped (Session N)` / `Deferred`.
Mark the implementing session in the activeContext.md memory bank too.

---

## Recommended implementation order

Optimised for **momentum** (small wins first → big leaps once warmed up)
and **dependency** (UIAutomation infrastructure shared between #3 and #6,
so do #3 first).

| # | Feature | Tier | Effort | Phase |
|---|---|---|---|---|
| 1 | [#20 Bubble opacity slider](#20-bubble-opacity-slider) | 3 | 1h | Warmup |
| 2 | [#19 First-run hotkey hint overlay](#19-first-run-hotkey-hint-overlay) | 3 | 0.5d | Warmup |
| 3 | [#17 Dictionary pinning + usage rank](#17-dictionary-pinning--usage-rank) | 3 | 0.5d | Warmup |
| 4 | [#5 Audio recovery after crash](#5-audio-recovery-after-crash) | 1 | 2d | Reliability |
| 5 | [#18 Better mic error messages](#18-better-mic-error-messages) | 3 | 1d | Reliability |
| 6 | [#15 Insights / Stats expansion](#15-insights--stats-expansion) | 3 | 1.5d | Polish |
| 7 | [#12 Translation mode](#12-translation-mode) | 2 | 1d | Polish |
| 8 | [#1 Selection-based AI transforms](#1-selection-based-ai-transforms) | 1 | 5–7d | **Big leap** |
| 9 | [#2 Voice editing commands](#2-voice-editing-commands-during-dictation) | 1 | 3–5d | Workflow |
| 10 | [#10 Smart vocabulary auto-learning](#10-smart-vocabulary-auto-learning) | 2 | 2–3d | Compound value |
| 11 | [#3 Context-aware dictation](#3-context-aware-dictation) | 1 | 5–7d | UIA infra |
| 12 | [#6 Continue thought mode](#6-continue-thought-mode) | 2 | 3–5d | Reuses #3 |

Total: roughly 4–6 weeks of focused work for one engineer.

---

# Tier 1 — Capability leaps

## #1 Selection-based AI transforms

**Status**: Not started
**Tier**: 1 · **Effort**: 5–7 days · **Phase**: Big leap

### What

Highlight any text in any app → press a hotkey → speak a short command →
AI rewrites the text in place. Examples:

- "make this shorter"
- "translate to Hindi"
- "fix grammar only"
- "convert to bullet points"
- "make it more formal"
- "summarize this"
- "explain this concept"

User can also create reusable named presets ("Polish", "Tighten",
"Translate to Hindi") and bind them to dedicated hotkeys.

### Why

Doubles popo's surface area. Today you only use popo when starting from
scratch. With Transforms you also use it to edit existing text. 5–10×
more touch points per day. Also: this is now table stakes — Wispr Flow
("Command Mode"), TypeGenius, SpeakOneAI all ship some version of this.

### Files

**Rust**:
- `apps/desktop/src-tauri/src/hotkey/mod.rs` — register a second
  global shortcut (default `Ctrl+Shift+E`); when fired:
  1. Send `Ctrl+C` via enigo
  2. Read clipboard
  3. Open new short voice-recording session (~5s cap, force-stop on release)
  4. Run Chirp transcription on the spoken command
  5. Send `{ system: transformPrompt(command), user: <selected_text>{selection}</selected_text> }` to Gemini
  6. Paste result via existing paste pipeline
  7. Restore clipboard
- `apps/desktop/src-tauri/src/commands/transforms.rs` — new module
  with `cmd_run_transform(presetId|null, customCommand|null)`
- `apps/desktop/src-tauri/src/lib.rs` — register the new command

**Frontend**:
- New page: `apps/desktop/src/pages/TransformsPage.tsx` — manage
  presets, sidebar entry between Modes and Snippets
- New component: `apps/desktop/src/components/transforms/TransformCard.tsx`
- New store: `apps/desktop/src/store/transformsStore.ts` (mirrors
  modesStore pattern: localStorage + Firestore + cross-webview sync)
- `apps/desktop/src/components/layout/Sidebar.tsx` — add nav entry
- `apps/desktop/src/hooks/useTransformsSync.ts` — Firestore subscription
- `apps/desktop/src/lib/cross-webview-sync.ts` — add `TRANSFORMS_CHANGED_EVENT`

### Data model

```ts
// packages/shared-types/src/index.ts
export interface Transform {
  id: string;
  name: string;            // "Polish", "Translate to Hindi"
  systemPrompt: string;    // the AI instruction
  hotkey?: string;         // optional dedicated hotkey
  iconBase64?: string;     // optional emoji or letter mark
  createdAt: number;
  usageCount: number;
}

export interface Settings {
  // ...existing fields
  transformHotkey: string; // default "Ctrl+Shift+E"
}
```

Seed transforms (factory defaults):
- **Polish** — "Improve grammar, punctuation, and flow without changing meaning."
- **Tighten** — "Make this 30% shorter without losing important details."
- **Translate to Hindi** — "Translate this English text to Hindi."
- **Translate to English** — "Translate this to English."
- **Bulletize** — "Convert this to a clean bullet-point list."
- **Formalize** — "Rewrite in formal professional tone."
- **Casualize** — "Rewrite in casual conversational tone."

### UI flow

1. User selects text in any app.
2. Presses `Ctrl+Shift+E`.
3. Pill morphs to a NEW state — `transform_listening` — with a
   different colour/ring than normal dictation. ~3 second window for
   them to speak a command.
4. Pill morphs to `processing` (existing DotMatrix state).
5. Result pasted at original selection.
6. Pill morphs to `success` then back to `sleep`.

Alternative entry: `Ctrl+Alt+P` runs the **default** transform (user-set
favourite, e.g. "Polish") without needing to speak the command.

### Edge cases

- **No selection**: pill shows error "Select some text first".
- **Selection but no transform spoken** (user releases too quickly):
  pill shows "Speak a command".
- **Command unintelligible**: Gemini returns identical text → we
  detect identical string and show "Couldn't parse command".
- **Selected text > 5000 chars**: warn user, allow but flag potential
  cost.
- **App doesn't support Ctrl+C** (rare): fallback shows error.

### Validation

- Test in: Notepad, VS Code, Cursor, Chrome (Gmail), Slack, Discord, Notion.
- Each transform tested: Polish, Tighten, Translate, Bulletize.
- Hotkey conflict resolution: try Ctrl+Shift+E → if fails, fall back to Ctrl+Alt+E.
- Custom hotkey on a preset overrides the default.
- Roundtrip latency target: < 2 seconds for typical 200-word selection.

### Dependencies

- Blocks: nothing
- Blocked by: nothing — all infrastructure exists (Gemini auth, paste,
  Chirp). This is purely composition + UI.

---

## #2 Voice editing commands during dictation

**Status**: Not started
**Tier**: 1 · **Effort**: 3–5 days · **Phase**: Workflow

### What

While dictating, certain phrases are recognized as commands instead of
transcribed literally. Initial set:

| Phrase | Action |
|---|---|
| "scratch that" / "delete that" | erase last sentence from working transcript |
| "new line" | insert `\n` |
| "new paragraph" | insert `\n\n` |
| "select that" / "select last sentence" | wrap last sentence in cursor selection markers |
| "cap that" | capitalize first letter of last word |
| "all caps that" | uppercase last word |
| "period" | literal `.` |
| "comma" | literal `,` |
| "question mark" | literal `?` |
| "exclamation" / "exclamation mark" | literal `!` |
| "stop dictation" / "stop listening" | end recording immediately |

### Why

Dictation alone is half a tool. Voice commands turn it into a complete
writing surface — you don't need to drop back to keyboard to fix a
mistake. The Open Dictate article explicitly called this out: "newer
AI-powered dictation tools focus on transcription quality while
ignoring command-driven editing." This is our opening.

### Files

**Rust**:
- `apps/desktop/src-tauri/src/voice_commands/mod.rs` — new module
  with the command parser
- `apps/desktop/src-tauri/src/voice_commands/parser.rs` — regex-based
  pattern matcher
- `apps/desktop/src-tauri/src/hotkey/mod.rs` — call
  `voice_commands::process(transcript)` after Chirp returns, before
  sending to Gemini polish
- `apps/desktop/src-tauri/src/gcp/streaming.rs` — pass voice command
  list as Chirp `phrase_set` adaptation hints (so "scratch that" gets
  recognized correctly)

**Frontend**:
- `apps/desktop/src/pages/SettingsPage.tsx` — add toggle "Voice
  editing commands" (default ON), with link to docs
- New mini help modal: list of supported commands with examples

### Data model

```ts
export interface Settings {
  // ...
  voiceCommandsEnabled: boolean; // default true
}
```

Internal Rust:
```rust
pub enum VoiceCommand {
    DeleteLastSentence,
    NewLine,
    NewParagraph,
    SelectLastSentence,
    CapitalizeLastWord,
    UpperCaseLastWord,
    InsertPunctuation(char),
    StopDictation,
}

pub fn parse_commands(transcript: &str) -> Vec<(usize, VoiceCommand)>;
//                                            ^ char index where command starts
```

### Algorithm

Two-pass approach over the Chirp transcript:

1. **Tokenize** the transcript into words preserving char offsets.
2. **Pattern-match** known command phrases (case-insensitive, with
   surrounding whitespace handling). Use anchored regexes for each
   command.
3. **Apply commands left-to-right** to a working buffer:
   - "scratch that" → drop the last sentence ending before the command's position
   - "new paragraph" → replace the matched phrase with `\n\n`
   - etc.
4. **Return cleaned transcript** with commands applied; pass to Gemini.

Important: commands must NOT be sent to Gemini in their literal form,
or Gemini will helpfully include them. Pre-strip them.

### Edge cases

- **Command in middle of sentence**: "I think we should scratch that
  whole approach" — should NOT trigger delete because "scratch that"
  has surrounding context. Use heuristic: command only triggers if
  there's a pause (Chirp interim-result gap) or if it's at sentence
  boundary.
- **Command immediately after another command**: "new paragraph new
  paragraph" → two `\n\n` (clean).
- **User says "literal scratch that"** (e.g. dictating instructions
  ABOUT voice commands): provide an escape phrase like "literally scratch that"
  → outputs "scratch that" verbatim.
- **Multi-language**: voice commands are English-only in v0.2. If
  user's language is hi-IN, commands disabled or transliterated
  (defer to v0.3).

### Validation

- Dictate "I want to write a short note. Scratch that. I want to
  write a long letter." → output: "I want to write a long letter."
- Dictate "First point. New line. Second point." → "First point.\n
  Second point."
- Dictate "send me a question mark" → must output literally
  "send me a question mark", not a literal `?` (use surrounding
  context heuristic).

### Dependencies

- Blocks: nothing
- Blocked by: nothing

---

## #3 Context-aware dictation

**Status**: Not started
**Tier**: 1 · **Effort**: 5–7 days · **Phase**: UIA infra

### What

Before transcribing, popo reads the surrounding text in the focused
input field. The dictated content is then transcribed AS IF
continuing that text, not starting cold.

Example:
- User has typed: `"Hi Sarah, just following up on"`
- User dictates: `"the proposal we discussed Tuesday"`
- Without context: paste = `"The proposal we discussed Tuesday."`
  (sentence-cap'd, awkward)
- With context: paste = `" the proposal we discussed Tuesday."`
  (continues naturally; no leading cap; preserves the comma flow)

### Why

Wispr Flow shipped this — once you have it, going back feels primitive.
Removes the "did I capitalize correctly?" mental overhead. Especially
useful for long-form writing where dictation interleaves with typing.

### Files

**Rust**:
- `apps/desktop/src-tauri/src/focus/uia.rs` — new module wrapping
  Win32 `IUIAutomation` COM API
- `apps/desktop/src-tauri/src/focus/mod.rs` — re-export `read_focused_value`
- `apps/desktop/src-tauri/src/hotkey/mod.rs` — `on_press` calls
  `focus::uia::read_focused_value()`, stores prefix in `RecordingSession`
- `apps/desktop/src-tauri/src/gcp/streaming.rs` + `chirp.rs` — accept
  `prefix_context` arg, prepend to `custom_prompt` so Chirp
  understands it's continuing context

**Frontend**:
- `apps/desktop/src/pages/SettingsPage.tsx` — add toggle "Context-aware
  dictation" (default ON). Sub-text: "Reads what you've already typed
  to continue naturally."

### Data model

```ts
export interface Settings {
  // ...
  contextAware: boolean; // default true
}

export interface SessionPayload {
  // ...
  prefixContext?: string; // captured text before dictation, for debugging
}
```

Rust:
```rust
pub struct FocusedValue {
    /// Text in the focused control before our dictation.
    pub prefix: String,
    /// True if we got this via UIA; false means fallback (e.g.
    /// the focused control doesn't expose ValuePattern).
    pub from_uia: bool,
}

pub fn read_focused_value() -> Option<FocusedValue>;
```

### Algorithm

In `on_press`:
1. Acquire foreground HWND (already done).
2. Get UIA element from HWND via `IUIAutomation::ElementFromHandle`.
3. Try `ElementFromHandle.GetFocusedElement()` for the actual focused
   sub-element (the text box, not the window).
4. Query for `ValuePattern` (most text inputs) or `TextPattern` (rich text).
5. Read the current value.
6. If too long (> 500 chars), take only the last 500 chars (avoid
   confusing Chirp with a wall of irrelevant context).
7. Pass to streaming start as `prefix_context`.

In Chirp call:
- The `custom_prompt` becomes:
  `"{mode prompt}\n\nThe user is continuing this text: \"{prefix}\". Their dictation continues from there."`
- Chirp's biasing then reflects the surrounding tone, capitalization,
  and topic.

In Gemini polish (if enabled):
- Pass `prefix` as a separate context block:
  `<existing_text>{prefix}</existing_text>\n<transcript>{transcript}</transcript>`
- Gemini system prompt extended: "The dictation is being inserted
  AFTER `<existing_text>`. Format the cleaned transcript so it
  flows naturally from where the existing text ends."

### Edge cases

- **No UIA available** (terminal, some Electron apps): fall back to
  no-context behavior. Don't fail.
- **Field is password type**: skip context read entirely (privacy).
  Detect via UIA `IsPasswordPattern`.
- **Field is empty**: pass empty prefix; Chirp behaves as normal.
- **Prefix has placeholder text** (e.g. ghost "Type a message..."):
  UIA usually distinguishes; if not, heuristic — if prefix looks
  like a placeholder (no real punctuation, all gray characters), skip.
- **Prefix is huge** (a 5000-char document): tail-truncate to last
  500 chars at sentence boundary.

### Validation

- Test in: Gmail compose, VS Code editor, Cursor chat, Slack message
  composer, Notepad, Notion paragraph, Chrome address bar.
- Check that paste flows naturally (lowercase if mid-sentence,
  capital if start).
- Verify password fields are NOT read (open a sign-in form, dictate
  into username, then password — second one should not see prefix).

### Dependencies

- Blocks: #6 Continue thought mode (reuses UIA infrastructure)
- Blocked by: nothing

### Risk

UIA on Windows is finicky. Some apps (Electron, Java Swing, some
Win32 custom controls) don't expose ValuePattern. Have a clean
fallback path that just disables the feature for that app silently.

---

## #5 Audio recovery after crash

**Status**: Not started
**Tier**: 1 · **Effort**: 2 days · **Phase**: Reliability

### What

If popo crashes mid-dictation OR the user quits the app while a
recording is active, the audio is preserved. On restart, History
shows a "Recover" button on any abandoned session — clicking it
re-runs the Chirp transcription pipeline on the saved audio.

### Why

Lost recordings are the most painful UX failure for a dictation tool —
the user invested speech-time and gets nothing. Even if rare, this
single feature builds enormous trust. Wispr added this in Q1 2026 and
Reddit threads thanked them.

### Files

**Rust**:
- `apps/desktop/src-tauri/src/audio/recovery.rs` — new module
- `apps/desktop/src-tauri/src/hotkey/mod.rs` — periodic flush in
  the waveform task; cleanup on graceful release
- `apps/desktop/src-tauri/src/lib.rs` — startup hook: scan recovery
  dir, emit `recovery:available` event with list of orphans
- `apps/desktop/src-tauri/src/commands/recovery.rs` — new module
  with `cmd_list_recoveries`, `cmd_recover_session(id)`,
  `cmd_discard_recovery(id)`

**Frontend**:
- `apps/desktop/src/components/history/RecoveryBanner.tsx` — banner
  at top of HistoryPage when orphans exist
- `apps/desktop/src/pages/HistoryPage.tsx` — render banner
- `apps/desktop/src/hooks/useRecovery.ts` — listen to
  `recovery:available` event, poll `cmd_list_recoveries` on mount

### Data model

Filesystem layout:
```
%APPDATA%\ai.popo.desktop\recovery\
  <timestamp>_<random>.wav        ← in-progress audio
  <timestamp>_<random>.json       ← session metadata sidecar
```

Sidecar JSON:
```json
{
  "id": "rec-<timestamp>-<random>",
  "startedAt": 1709123456000,
  "lastFlushAt": 1709123466000,
  "sampleRate": 48000,
  "channels": 1,
  "appName": "VS Code",
  "appIconBase64": "...",
  "modeId": "mode-auto",
  "language": "en-IN"
}
```

### Algorithm

**Capture side** (in waveform task running every 40ms):
- Every 5 seconds, take the ring-buffer snapshot and append to the
  recovery WAV file (open file once at session start, keep handle).
- Update sidecar's `lastFlushAt` timestamp.
- Use a `tokio::sync::Mutex` to coordinate flush vs final-snapshot.

**Cleanup side** (in `on_release` after successful paste):
- Delete the recovery WAV + sidecar files for this session id.

**Crash detection** (on app startup):
- Scan `%APPDATA%\ai.popo.desktop\recovery\`
- For each `<id>.wav` + `<id>.json` pair:
  - If `lastFlushAt` is more than 30 minutes old, mark as recovery
    candidate.
  - Emit `recovery:available` event with list.

**Recovery UI**:
- Banner at top of History: "We saved 1 unfinished recording. [Recover] [Discard]"
- Clicking Recover: run Chirp on the WAV → create normal Session,
  delete recovery files.
- Clicking Discard: delete recovery files.

### Edge cases

- **Multiple crashes in a row**: multiple recoveries pending. List
  them in the banner: "We saved 3 unfinished recordings."
- **Recovery WAV is corrupt**: WavReader::open fails. Show
  "Recovery failed — file corrupt" with a Discard button.
- **Recovery > 3 minutes** (longer than `MAX_BUFFER_SAMPLES`): truncate
  on read, transcribe what we have.
- **Mode no longer exists** (user deleted it): fallback to default mode.
- **GCP no longer configured**: show "Recover requires GCP setup."

### Validation

- Start dictating, force-quit popo (Task Manager). Restart. History
  should show recovery banner.
- Click Recover. Transcript should match what was said before the kill.
- Crash during the first 5 seconds (before first flush): WAV file
  is empty. Recovery shows "No usable audio."
- Successful dictation → restart → no banner (cleanup worked).

### Dependencies

- Blocks: nothing
- Blocked by: nothing

---

# Tier 2 — Strong differentiators

## #6 Continue thought mode

**Status**: Not started
**Tier**: 2 · **Effort**: 3–5 days · **Phase**: Reuses #3

### What

Different hotkey from main dictation. When pressed, popo reads the
current paragraph at your cursor (via UIA) and listens for a short
3-second hint. Then sends both to Gemini with a "continue this
paragraph based on the hint, in the same voice" prompt. Pastes the
continuation at cursor.

Example:
- You're writing: `"I think the best approach for migration would be"`
- Hotkey + you say: `"phase 1 first then evaluate"`
- AI continues: `" to ship phase 1 first and evaluate carefully before
  committing to phase 2."`

### Why

This is dictation-meets-Copilot. Different from standard dictation
because it preserves your existing prose voice, doesn't start fresh.
Useful for writers who get stuck mid-paragraph.

### Files

**Rust**:
- `apps/desktop/src-tauri/src/hotkey/mod.rs` — register secondary
  hotkey (default `Ctrl+Shift+G`); when fired, reuse #3's
  `focus::uia::read_focused_value()` to get prefix, then run a
  short dictation, then call new `gcp::gemini::continue_thought()`.
- `apps/desktop/src-tauri/src/gcp/gemini.rs` — add `continue_thought`
  function with specialized prompt.

**Frontend**:
- `apps/desktop/src/pages/SettingsPage.tsx` — add hotkey input
  for "Continue thought" + toggle. Default hotkey: `Ctrl+Shift+G`.

### Data model

```ts
export interface Settings {
  // ...
  continueThoughtEnabled: boolean; // default true
  continueThoughtHotkey: string;   // default "Ctrl+Shift+G"
}
```

### Algorithm

1. Hotkey pressed → read prefix via UIA (#3's infrastructure).
2. Short dictation (3-5 second cap, force-stop on release).
3. Chirp returns hint text.
4. Gemini prompt:
   ```
   You are a writing assistant continuing the user's text. They have
   already written the text inside <prefix> tags. They have given you
   a brief hint inside <hint> tags about what to write next.

   Write 1-3 sentences that continue from where <prefix> ends, in the
   user's voice and tone, expressing the idea from <hint>. Do NOT
   repeat or rewrite the prefix. Output only the continuation text.

   <prefix>{prefix}</prefix>
   <hint>{hint}</hint>
   ```
5. Paste the continuation at cursor.

### Edge cases

- **Empty prefix**: feature disabled — show "Position cursor in some text first".
- **No hint dictated** (silent release): show "Speak a hint about what to continue with".
- **Hint is itself a full sentence**: that's fine; Gemini works with it.
- **Continuation duplicates prefix words**: rare; mitigated by the
  "do NOT repeat or rewrite the prefix" rule.

### Validation

- Test with each Auto / Casual / Professional / Email modes' default tone.
- In Gmail mid-email: should add 1-2 sentences in email tone.
- In Slack message: should add casual continuation.

### Dependencies

- Blocks: nothing
- Blocked by: **#3 (Context-aware dictation)** — reuses UIA infra.

---

## #10 Smart vocabulary auto-learning

**Status**: Not started
**Tier**: 2 · **Effort**: 2–3 days · **Phase**: Compound value

### What

When the user manually edits a transcript in History, popo diffs old
vs new. Frequently-corrected words become Dictionary candidates. After
3+ corrections of the same word ("Vyom" → "Vyomesh"), surface a
non-blocking toast: "We noticed you fix 'Vyom' to 'Vyomesh' often.
Add to dictionary?" One-click adds → improves Chirp accuracy
permanently for that user.

### Why

Way better UX than asking users to manually populate Dictionary. It
learns from their actual editing patterns. Users who'd never bother
filling Dictionary manually get the benefit automatically. Compound
value: every correction makes the next dictation slightly better.

### Files

**Rust**:
- `apps/desktop/src-tauri/src/vocabulary_learning/mod.rs` — diff
  algorithm + candidate tracker

**Frontend**:
- `apps/desktop/src/store/vocabularyCandidatesStore.ts` — new store
  tracking candidates with counts
- `apps/desktop/src/components/history/SessionDetail.tsx` — on save
  edit, compute diff and queue candidates
- `apps/desktop/src/components/shared/VocabularyCandidateToast.tsx` —
  non-blocking toast that appears at bottom-right when threshold hit
- `apps/desktop/src/hooks/useVocabularyCandidates.ts` — orchestrates
  toast display logic
- `apps/desktop/src/lib/firestore.ts` — sync candidates collection

### Data model

```ts
export interface VocabularyCandidate {
  // The word we want to learn (the "after" version of the correction)
  correctSpelling: string;
  // Possible incorrect transcriptions Chirp produced (the "before" versions)
  observedMisspellings: string[];
  // How many times user has made this correction
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
  // null = not yet acted on. "added" / "dismissed"
  resolved: "added" | "dismissed" | null;
}
```

Stored in localStorage at `popo:vocab-candidates`, synced to
Firestore at `users/{uid}/vocabCandidates/{correctSpelling}`.

### Algorithm

**On edit save** (in `SessionDetail.handleSaveEdit`):
1. Compute word-level diff between old and new transcript.
   Use simple LCS or `dissimilar`-style algorithm.
2. For each (oldWord, newWord) substitution:
   - Heuristic: only count if both words are 3+ chars, both
     start with letter, and they share at least 50% of characters
     (Levenshtein-like). This filters out unrelated changes
     (e.g. "the" → "a" isn't a vocabulary issue).
3. Record candidate: `correctSpelling = newWord`, append `oldWord`
   to `observedMisspellings`, increment `count`.
4. If `count` reaches threshold (3), emit a `vocab:candidate-ready`
   event.

**Toast UI**:
- Appears bottom-right, dismissible. Shows for 10 seconds.
- "We noticed you fix 'Vyom' to 'Vyomesh' often. **[Add to dictionary]** **[Dismiss]**"
- Add → calls `dictionaryStore.addEntry(newWord)` and marks candidate
  as `resolved: "added"`.
- Dismiss → marks `resolved: "dismissed"`. Won't appear again.

### Edge cases

- **User undoes their own edit**: handled because the new transcript
  matches the old one and no diff candidates produced.
- **Punctuation changes**: filter candidates to only words.
- **Pure case changes** (foo → Foo): skip (not a vocabulary issue;
  capitalization is a Chirp limitation we don't fix this way).
- **User corrects same word two different ways** ("Vyom" → "Vyomesh"
  once, "Vyom" → "Vom" once): treat each as separate candidate,
  by `correctSpelling`. They'll both queue but neither will hit
  threshold of 3 alone.

### Validation

- Edit one transcript, change "Vyom" to "Vyomesh", save. No toast yet.
- Edit two more transcripts the same way. Toast appears.
- Click Add → "Vyomesh" appears in DictionaryPage.
- Edit a fourth transcript with "Vyom" → "Vyomesh" — no toast (already added).
- Dismiss a candidate → never reappears even if count grows.

### Dependencies

- Blocks: nothing
- Blocked by: existing `historyStore.updateSession` (already shipped) and
  `dictionaryStore.addEntry` (already shipped).

---

## #12 Translation mode

**Status**: Not started
**Tier**: 2 · **Effort**: 1 day · **Phase**: Polish

### What

A new factory mode (or a per-mode field) that translates while
formatting. Speak in language X → cleaned text appears at cursor in
language Y. Most useful for:

- Indian users who think in Hindi but write to English-speakers
- Users who want to send Hindi/regional-language messages but speak
  more comfortably in English
- Multilingual workplaces

### Why

Chirp handles multilingual transcription, but translation is a Gemini
job. Adding it as a mode type is one prompt away. For Indian markets
specifically, "speak Hinglish, get polished English" is a killer
feature.

### Files

**Frontend**:
- `apps/desktop/src/store/modesStore.ts` — extend `Mode` type with
  optional `translateTo` field
- `apps/desktop/src/components/modes/ModeEditor.tsx` — add
  "Translate output to" dropdown (optional)
- `apps/desktop/src/components/modes/ModeCard.tsx` — show translation
  badge if mode has `translateTo` set

**Rust**:
- `apps/desktop/src-tauri/src/hotkey/mod.rs` — when resolving mode
  prompt, if `translateTo` is set, prepend translation instruction
- `apps/desktop/src-tauri/src/commands/settings.rs` — extend
  `cmd_set_mode_bindings` payload to include `translateTo`

### Data model

```ts
export interface Mode {
  // ...existing fields
  /**
   * If set, the mode's prompt is augmented to translate the cleaned
   * transcript into this target language. Use language codes like
   * "en-US", "hi-IN", "es-ES".
   *
   * Translation happens INSIDE Gemini polish, after Chirp.
   * Auto-format must be ON for translation to take effect (since
   * it's a Gemini-side feature).
   */
  translateTo?: string;
}
```

Seed mode additions:
- **Hindi → English** (`mode-translate-hi-en`)
- **English → Hindi** (`mode-translate-en-hi`)

### Algorithm

When `translateTo` is set, prepend to the mode's existing prompt:
```
Translate the cleaned transcript to {targetLanguage}, preserving
tone and formality. Apply the cleanup rules above to the translated
output.
```

(The cleanup rules from the mode's existing prompt still apply, just
in the target language.)

### Edge cases

- **autoFormat is OFF**: translation can't happen (it's a Gemini
  feature). Show a warning chip in ModeCard: "⚠ Translation
  requires Auto-format ON".
- **Source language doesn't match target**: still works (Gemini just
  translates English→English which is identity). Maybe warn at edit
  time.
- **Multi-language source** (Chirp returns Hinglish): Gemini handles
  it fine.

### Validation

- Mode with `translateTo: "hi-IN"`. Speak in English. Output should
  be Hindi (Devanagari script).
- Mode with `translateTo: "en-US"`. Speak in Hindi. Output should be
  English.
- Mixed-language input ("aaj I am thinking ki..."): output should be
  in target language with cohesive flow.

### Dependencies

- Blocks: nothing
- Blocked by: nothing — pure prompt composition.

---

# Tier 3 — Polish

## #15 Insights / Stats expansion

**Status**: Not started
**Tier**: 3 · **Effort**: 1.5 days · **Phase**: Polish

### What

The current StatsPage has 4 cards + language breakdown + week heatmap.
Add (in popo's quieter register):

- **WPM personal best + 7-day rolling average** (small badge)
- **Per-app pie chart** with mini app icons (use existing
  `appIconsStore`)
- **Most-corrected words** list (after #10 ships, this becomes useful)
- **Cost-over-time line chart** (we have all the data — `gcpCostEstimate`
  per session)
- **Mode usage breakdown** (which mode you use most)

NOT adding (off-brief): leaderboards, archetypes, catchphrases,
streaks-as-game.

### Why

You already have the data. Surfacing it gives users insight into their
own usage without gamifying it. Especially the cost-over-time chart
is useful for users to track their GCP spend.

### Files

**Frontend** (all):
- `apps/desktop/src/pages/StatsPage.tsx` — add new sections
- `apps/desktop/src/components/stats/AppUsagePieChart.tsx` — new
- `apps/desktop/src/components/stats/CostOverTimeChart.tsx` — new
- `apps/desktop/src/components/stats/ModeUsageBars.tsx` — new
- `apps/desktop/src/components/stats/MostCorrectedWords.tsx` — new
  (reads from `vocabularyCandidatesStore` — implement after #10)
- `apps/desktop/src/lib/stats-compute.ts` — extend with new
  computations: `computeAppUsage`, `computeCostOverTime`,
  `computeModeUsage`

### Data model

No new types — all derivable from existing `Session[]` and `Mode[]`.

### Algorithm

```ts
// stats-compute.ts additions
interface AppUsageBucket {
  appName: string;
  iconBase64?: string;
  count: number;
  percentage: number;
}

export function computeAppUsage(sessions: Session[]): AppUsageBucket[];
//  Group by appName, count, sort desc, take top 8.

interface CostPoint {
  day: number; // unix ms at midnight
  cost: number; // sum of gcpCostEstimate for that day
}

export function computeCostOverTime(sessions: Session[], days: number): CostPoint[];
//  Bucket sessions by day for last `days` days, sum costs.

interface ModeUsageBucket {
  modeId: string;
  modeName: string;
  count: number;
  totalDuration: number; // ms
}

export function computeModeUsage(sessions: Session[], modes: Mode[]): ModeUsageBucket[];
//  Group by modeId.
```

### UI

- Pie chart: SVG-based, no chart library. 8 segments max + "Other".
- Cost line chart: SVG line + dots, last 30 days. Y-axis: USD with one
  decimal.
- Mode usage: horizontal bars (reuse `LanguageBreakdown.tsx` pattern).
- WPM badge: small chip near the top "Best WPM: 42 (yesterday)".

### Edge cases

- **No sessions yet**: each section shows empty state ("No data yet").
- **All cost is 0** (user has fake_transcribe still): hide the cost
  chart entirely.
- **Single mode used 100% of time**: show the bar but no others.

### Validation

- Dictate 5 sessions in Chrome, 3 in VS Code → pie shows
  Chrome 62%, VS Code 38%.
- Verify cost chart sums to total visible on the cost card.
- Mode usage matches actual mode usage.

### Dependencies

- Blocks: nothing
- Blocked by: **#10** for "Most-corrected words" widget specifically;
  rest can ship independently.

---

## #17 Dictionary pinning + usage rank

**Status**: Shipped (Session 49) — pinning only; usage-count tracking deferred to a future session (would require Rust to emit per-phrase match events)
**Tier**: 3 · **Effort**: 0.5 day · **Phase**: Warmup

### What

In DictionaryPage, every entry gets:
- A **star button** to pin it (pinned = always at top)
- Sort order: pinned first → then by usage count desc → then by
  createdAt desc

The boost mechanic in Chirp adaptation already exists; this is purely
UI surfacing.

### Why

Almost free given the data is already there. Helps users with long
dictionaries find their critical phrases fast.

### Files

**Frontend**:
- `apps/desktop/src/store/dictionaryStore.ts` — extend
  `DictionaryEntry` with `pinned: boolean`, sort by pinned-first
  in the UI render layer
- `apps/desktop/src/pages/DictionaryPage.tsx` — add star toggle
  per row, render in correct sort order
- `apps/desktop/src/lib/firestore.ts` — sync the `pinned` field

### Data model

```ts
export interface DictionaryEntry {
  // ...existing
  pinned: boolean; // default false
}
```

### Algorithm

Trivial. In render:
```ts
const sorted = [...entries].sort((a, b) => {
  if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
  if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount;
  return b.createdAt - a.createdAt;
});
```

Star button: small Phosphor `<Star weight={pinned ? "fill" : "regular"} />`
on each row. Click toggles `pinned`.

### Validation

- Add 5 entries, star one. It should jump to top.
- Unstar → drops back to its sort-order position.
- Refresh app → pinned state survives (localStorage + Firestore).

### Dependencies

- Blocks: nothing
- Blocked by: nothing.

---

## #18 Better mic error messages

**Status**: Not started
**Tier**: 3 · **Effort**: 1 day · **Phase**: Reliability

### What

Replace generic "no audio detected" / "mic error" with specific,
actionable messages:

| Detected condition | Message + action |
|---|---|
| Mic unplugged | "Microphone unplugged — plug in or pick another in Settings." |
| Mic in use by another app | "Mic in use by Zoom — close it or use a different mic." |
| Permission blocked | "Mic blocked by Windows. **[Open settings]**" |
| Device name unknown | "Mic error — restart the app or pick a different mic." |

### Why

A vague error makes users feel the tool is broken. A specific error
with a one-click fix makes them feel the tool is helpful even when
something's wrong. This is a major satisfaction lever for negligible
effort.

### Files

**Rust**:
- `apps/desktop/src-tauri/src/audio/capture.rs` — categorize cpal
  errors by inspecting the error variant + try probing
  `IMMDeviceEnumerator` for explanation
- `apps/desktop/src-tauri/src/focus/mod.rs` — new helper
  `open_mic_settings_panel()` → launches `ms-settings:privacy-microphone`
- `apps/desktop/src-tauri/src/lib.rs` — register `cmd_open_mic_settings`

**Frontend**:
- `apps/desktop/src/components/pill/ErrorTooltip.tsx` — already exists;
  extend payload type to include optional `action` field
- `apps/desktop/src-tauri/src/hotkey/mod.rs` — emit specific error
  payloads in the various failure paths
- Pill clicks the action button → invokes the right command

### Data model

Extend the existing `ErrorPayload`:
```rust
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
    pub action: Option<ErrorAction>, // NEW
}

pub enum ErrorAction {
    OpenMicSettings,
    OpenAppSettings { tab: String },
    Retry,
}
```

### Algorithm

In `audio::capture::start`, categorize errors:

- `cpal::DeviceNameError` → "Mic error" + retry action
- `cpal::DefaultStreamConfigError::DeviceNotAvailable` → "Mic
  unplugged"
- `cpal::BuildStreamError::DeviceNotAvailable` → same as above
- `cpal::BuildStreamError::StreamConfigNotSupported` → "Mic
  config error — pick a different mic"
- Probe Win32 to see if the device exists at all but is in use:
  `IAudioClient::Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE)` returning
  `AUDCLNT_E_ALREADY_INITIALIZED` → "Mic in use by another app"
- Permission denied (Win11 mic privacy) → check
  `MicrophoneAccessSettings` via `windows-rs`

### Validation

- Unplug USB mic → press hotkey → correct error.
- Open Voice Recorder, start recording, then press popo hotkey →
  "Mic in use" message.
- Toggle Win11 mic permission off → press hotkey → "blocked by
  Windows" + open-settings button works.

### Dependencies

- Blocks: nothing
- Blocked by: nothing.

---

## #19 First-run hotkey hint overlay

**Status**: Shipped (Session 49)
**Tier**: 3 · **Effort**: 0.5 day · **Phase**: Warmup

### What

For the first 3 dictations after install, show a small floating hint
near the pill:

- 1st dictation: "Press Esc to cancel anytime"
- 2nd dictation: "Press Ctrl+Shift+M for mode picker"
- 3rd dictation: "All set! Tweak more in Settings → Help"

Auto-dismiss after each dictation. Counter persisted in localStorage.

### Why

popo has hidden depth — Esc cancel, Quick switcher, modes — that new
users can't discover without docs. This surfaces it organically with
zero clicks.

### Files

**Frontend**:
- `apps/desktop/src/components/pill/FirstRunHint.tsx` — new
- `apps/desktop/src/pages/PillPage.tsx` — render `<FirstRunHint />`
- localStorage key: `popo:first-run-dictation-count`

### Data model

Pure localStorage, no Firestore. Just a counter:
```ts
// localStorage
"popo:first-run-dictation-count": "0" | "1" | "2" | "3+"
```

### Algorithm

- On `pill:state:sleep` event after a successful dictation, increment
  counter (capped at 3).
- During the next `pill:state:ready` (start of next dictation), if
  counter < 3, show the hint for that count.
- Hint position: 60px above the pill, centred.
- Hint visual: small dark pill-shaped tooltip (matches DESIGN_SYSTEM
  §3 toasts), Geist Pixel font, fade out after 3 seconds.

### Edge cases

- **User cancels first dictation** (Esc): don't increment counter.
- **localStorage unavailable** (private browsing in Vite preview):
  hint never shows. Fine.

### Validation

- Fresh install (clear localStorage): first dictation shows Esc hint.
- Cancel first dictation → still on counter 0.
- Three successful dictations → fourth dictation shows no hint.

### Dependencies

- Blocks: nothing
- Blocked by: nothing.

---

## #20 Bubble opacity slider

**Status**: Shipped (Session 49)
**Tier**: 3 · **Effort**: 1 hour · **Phase**: Warmup

### What

In Settings → Recording, add a slider for "Pill opacity in sleep
state" (range 0.0 to 1.0, default 0.18). Also a separate slider
for active states (default 1.0).

### Why

Some users find the sleep-state pill at 0.18 still too visible over
fullscreen content (videos, games). Others want it brighter to find
it. A slider is a 5-line change that addresses both.

### Files

**Frontend**:
- `apps/desktop/src/pages/SettingsPage.tsx` — add two sliders to
  Recording group
- `apps/desktop/src/components/pill/PillOverlay.tsx` — replace
  hardcoded `0.18` and `1.0` with `settings.pillSleepOpacity` and
  `settings.pillActiveOpacity` from store
- `apps/desktop/src/components/shared/Slider.tsx` — new primitive
  (if not already shipped)

### Data model

```ts
export interface Settings {
  // ...
  pillSleepOpacity: number;  // 0.0–1.0, default 0.18
  pillActiveOpacity: number; // 0.0–1.0, default 1.0
}
```

### Algorithm

Trivial — just bind opacity values from settings to the pill's
inline style.

### UI

```
Recording group →
  Pill opacity (sleep) [——●———————] 18%
  Pill opacity (active) [—————————●] 100%
```

### Edge cases

- **User sets sleep opacity to 0.0**: pill is invisible in sleep
  state. That's a user choice; don't override. Show small note
  next to the slider: "0% means pill is invisible at rest."
- **User sets active opacity below 0.5**: still readable but faint.
  Don't enforce minimum; let them experiment.

### Validation

- Adjust slider → pill responds in real time (cross-webview sync
  already covers this).
- Restart app → values persist.

### Dependencies

- Blocks: nothing
- Blocked by: nothing.

---

# Cross-cutting concerns

## Migration plan for new Settings fields

Several features add new `Settings` fields. The existing migration
pattern handles this fine:

```ts
const next: Settings = { ...DEFAULT_SETTINGS, ...current, ...remote };
```

Defaults take effect for any field not present in stored state.
Bump no version constant required — just ensure DEFAULT_SETTINGS
has the new field with a sensible default.

## Cross-webview sync requirements

Any new store that needs to be visible in the switcher / pill webview
must:
1. Persist to localStorage on every mutation
2. Hydrate from localStorage in `create()`
3. Emit a cross-webview event (add to `lib/cross-webview-sync.ts`)
4. Provide a bypass action for the rehydrate path
5. Be listed in `useCrossWebviewSync` hook

This applies to: transformsStore (#1), vocabularyCandidatesStore (#10).

## Tauri capabilities for new windows

If any feature adds a new Tauri window (none of the 12 selected
features do), remember to add it to
`apps/desktop/src-tauri/capabilities/default.json`'s `windows` array.
Otherwise emit/listen will silently fail (Session 41 lesson).

## Testing matrix

When implementing each feature, test against this baseline app set:

- **Browser**: Chrome (Gmail, ChatGPT, Notion web)
- **IDE**: VS Code, Cursor
- **Chat**: Slack, Discord
- **Office**: Word, Notepad, Notion desktop
- **Edge cases**: Terminal (cmd, PowerShell), web-rendered apps
  (Spotify, Figma)

## Documentation

For each shipped feature, update:
1. `memory-bank/activeContext.md` with a new Session N entry
2. `memory-bank/progress.md` checklist
3. `.clinerules` Session log
4. This file (`docs/ROADMAP.md`) — flip Status to `Shipped (Session N)`
5. The feature's user-visible help text in Settings (if applicable)

---

# Appendix: deferred features (DO NOT ship without re-discussion)

These were proposed in the chat but the user explicitly didn't
select them. Documented here so we don't accidentally re-propose them.

- **Auto-cleanup levels** (None/Light/Medium/Heavy) — Tier 1 #4
- **Live interim transcript on pill** — Tier 2 #7
- **File transcription (drag & drop)** — Tier 2 #8
- **Dictation history "re-cleanup"** — Tier 2 #9
- **Voice macros** — Tier 2 #11
- **Banking-app auto-pause** — Tier 3 #13
- **Mouse-button hotkey** — Tier 3 #14
- **Inline retry from History** — Tier 3 #16

If the user requests any of these later, the pre-existing chat
analysis applies — don't redo the design conversation, just refer
back.

# Appendix: hard "no" features (off-brief)

These were considered and explicitly rejected. Don't re-propose
without a brief amendment:

- ❌ Leaderboards / streaks / gamification
- ❌ Always-on listening / wake words (privacy-hostile)
- ❌ Built-in note-taking app
- ❌ Mobile companion app (out of v0.x scope)
- ❌ Meeting recording / multi-speaker / live captions
- ❌ Communication archetype / catchphrase analytics
- ❌ AI agent integration ("send email to Sarah" via voice)
