import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { MagnifyingGlass, AppWindow } from "@phosphor-icons/react";
import type { Mode } from "@popo/shared-types";
import { useModesStore } from "../store/modesStore";
import { useAppIconsStore } from "../store/appIconsStore";
import { useSettingsStore } from "../store/settingsStore";
import {
  rehydrateSettings,
  rehydrateModes,
  rehydrateAppIcons,
  subscribeCrossWebview,
  SETTINGS_CHANGED_EVENT,
  MODES_CHANGED_EVENT,
  APP_ICONS_CHANGED_EVENT,
} from "../lib/cross-webview-sync";

/**
 * Re-hydrate Settings + Modes + AppIcons from localStorage into the
 * switcher's Zustand stores. Tauri runs each webview in its own JS
 * process, so a change made in the main window's stores does NOT
 * propagate to the switcher's stores — only localStorage is shared.
 *
 * Three complementary paths keep the switcher fresh:
 *   1. `visibilitychange → visible` calls this on every re-show
 *      (covers the common "main window changed something while
 *      switcher was hidden" case).
 *   2. The cross-webview event listeners (in the effect below) call
 *      the per-store rehydrate function whenever the relevant event
 *      arrives — even if the switcher is currently visible.
 *   3. Initial mount also rehydrates so cold start (after a fresh
 *      app launch) sees the persisted icons even before any event
 *      fires.
 *
 * No Firestore writes happen here — the rehydrate helpers use
 * `setState` (bypass path), and they're idempotent (only fire when
 * the parsed value differs from current state).
 */
function rehydrateFromLocalStorage(): void {
  rehydrateSettings();
  rehydrateModes();
  rehydrateAppIcons();
}

/**
 * Build the `cmd_set_mode_bindings` payload from the current store
 * snapshot. This mirrors the logic in `useApplySettingsToRust` —
 * which only runs in the main window webview, NOT here. The switcher
 * has to push its own update directly to Rust on every pick or Rust
 * never learns about the new default.
 */
function buildModeBindingsPayload(
  modes: Mode[],
  defaultModeId: string | null | undefined,
) {
  return modes.map((m) => ({
    id: m.id,
    name: m.name,
    systemPrompt: m.systemPrompt,
    apps: m.apps ?? [],
    isDefault: defaultModeId ? m.id === defaultModeId : !!m.isDefault,
    hotkey: (m.hotkey ?? "").trim(),
    soundPreset: m.soundPreset ?? "default",
  }));
}

/**
 * QuickSwitcherPage — the React side of the Ctrl+Shift+M quick mode
 * switcher window.
 *
 * Rust owns the lifecycle: it registers the global shortcut, opens this
 * webview window (label "switcher", transparent, always-on-top,
 * focusable) at /switcher, and saves the caller's foreground HWND so we
 * can restore focus on hide. The React tree stays mounted across
 * show/hide cycles (Tauri doesn't destroy the webview), so we reset
 * search + selection on every `visibilitychange → visible`.
 *
 * Commands used:
 *   - cmd_hide_mode_switcher() — hide window + restore caller focus
 *
 * Mode-pick semantics (Session 38 change):
 *   The switcher pick now UPDATES `settings.defaultModeId` directly
 *   (sticky), instead of stashing a one-shot `pending_forced_mode_id`
 *   that gets consumed on the next dictation. This matches the user's
 *   mental model ("I picked Email — keep using Email until I change
 *   again") and means the Settings page reflects the pick. Per-mode
 *   hotkeys remain one-shot via their own pathway in hotkey/mod.rs.
 *
 * Visual register: floating command palette, darker than the main
 * window canvas (rgba(20,20,20,0.94) with 20px backdrop blur) because
 * it's an overlay on top of whatever app the user was in.
 *
 * Selected-row 2px left edge mirrors the History SessionRow treatment
 * (brief-logged exception to impeccable §12.3 — see DESIGN_SYSTEM §12).
 */
export default function QuickSwitcherPage() {
  const modes = useModesStore((s) => s.modes);
  const iconsByName = useAppIconsStore((s) => s.iconsByName);
  const defaultModeId = useSettingsStore((s) => s.settings.defaultModeId);

  const [search, setSearch] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ── Sort + filter ────────────────────────────────────────────────
  // Sort: default first → usageCount desc → createdAt asc (stable).
  const sorted = useMemo(() => {
    return [...modes].sort((a, b) => {
      const aIsDefault = a.id === defaultModeId ? 1 : 0;
      const bIsDefault = b.id === defaultModeId ? 1 : 0;
      if (aIsDefault !== bIsDefault) return bIsDefault - aIsDefault;
      if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
      return a.createdAt - b.createdAt;
    });
  }, [modes, defaultModeId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.systemPrompt.toLowerCase().includes(q),
    );
  }, [sorted, search]);

  // Reset the selection cursor whenever the filter list changes so the
  // first visible row is always highlighted.
  useEffect(() => {
    setSelectedIdx(0);
  }, [search]);

  // Clamp selection when the filtered list shrinks below the cursor.
  useEffect(() => {
    if (selectedIdx >= filtered.length) {
      setSelectedIdx(filtered.length > 0 ? filtered.length - 1 : 0);
    }
  }, [filtered.length, selectedIdx]);

  // ── Re-show lifecycle ────────────────────────────────────
  // The webview persists across hides. Reset state + re-hydrate
  // stores from localStorage (the main window may have changed
  // settings or modes since we were last visible) + re-focus the
  // search input whenever the document becomes visible again.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // Pull the latest settings + modes from localStorage. The
        // main window webview has its own Zustand stores; the only
        // bridge between the two webviews is localStorage. Without
        // this, the switcher would render with whatever it had
        // when it was first created — even if the user changed the
        // default mode in Settings five minutes ago.
        rehydrateFromLocalStorage();
        setSearch("");
        setSelectedIdx(0);
        // Ensure the JS context itself has focus (Rust's
        // SetForegroundWindow gives OS focus, but the Chromium
        // webview inside the Tauri window needs a separate
        // window.focus() to route keyboard events to our React
        // handler). Without this, esc/enter/arrows go nowhere.
        window.focus();
        // Then focus the search input specifically.
        window.setTimeout(() => searchRef.current?.focus(), 20);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Initial mount focus + hydrate (first open after window creation).
  useEffect(() => {
    rehydrateFromLocalStorage();
    window.focus();
    searchRef.current?.focus();
  }, []);

  // Live cross-webview sync. When the main window updates Settings
  // (or ModeCard upserts/deletes a mode, or a dictation completes
  // and updates appIcons) WHILE the switcher is showing, this effect
  // picks the change up immediately. Without it, the switcher would
  // only refresh on the next visibility event — which means a user
  // who opened the switcher, alt-tabbed to Settings, changed
  // something, alt-tabbed back, would still see the stale state
  // until they hid + reshowed the switcher.
  useEffect(() => {
    let unlistenSettings: (() => void) | null = null;
    let unlistenModes: (() => void) | null = null;
    let unlistenAppIcons: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      const a = await subscribeCrossWebview(SETTINGS_CHANGED_EVENT, () => {
        rehydrateSettings();
      });
      const b = await subscribeCrossWebview(MODES_CHANGED_EVENT, () => {
        rehydrateModes();
      });
      const c = await subscribeCrossWebview(APP_ICONS_CHANGED_EVENT, () => {
        rehydrateAppIcons();
      });
      if (cancelled) {
        a();
        b();
        c();
        return;
      }
      unlistenSettings = a;
      unlistenModes = b;
      unlistenAppIcons = c;
    })();

    return () => {
      cancelled = true;
      unlistenSettings?.();
      unlistenModes?.();
      unlistenAppIcons?.();
    };
  }, []);

  // Keep the highlighted row scrolled into view when keyboarding
  // through a long list.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(
      `[data-row-idx="${selectedIdx}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  // ── Actions ────────────────────────────────────────────────────────
  //
  // pickMode + cancel are wrapped in useCallback so the global
  // keydown listener (registered in a separate effect below) reads
  // a stable reference and the latest filtered/selectedIdx via the
  // closure-on-render pattern.

  const pickMode = useCallback(async (mode: Mode) => {
    // Session 39 (this turn): the switcher webview does NOT mount
    // useApplySettingsToRust (only AppShell does), so updating the
    // settingsStore here would only persist to localStorage +
    // Firestore — Rust's mode_bindings would still point at the
    // OLD default until the main window re-evaluated its hook.
    // Result: the user picked a mode, the switcher closed, but the
    // very next dictation kept using the previous mode.
    //
    // Fix: push the change to Rust DIRECTLY from here, then update
    // the store so any other open webview (Settings page, ModeCard
    // ◆ marker) reflects it on next visibility/render.
    const next = mode.id;

    // 1. Update settingsStore (localStorage + Firestore best-effort).
    useSettingsStore.getState().update({ defaultModeId: next });

    // 2. Build + push the mode_bindings payload Rust uses to resolve
    //    the active mode at press time. We rebuild from the latest
    //    modes snapshot so any edits the user made to mode prompts
    //    are honoured immediately.
    const latestModes = useModesStore.getState().modes;
    const payload = buildModeBindingsPayload(latestModes, next);
    try {
      await invoke("cmd_set_mode_bindings", { bindings: payload });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[popo] cmd_set_mode_bindings failed:", err);
    }

    // 3. Push the new auto-format prompt so Gemini polish (when
    //    enabled) uses the picked mode's systemPrompt. This mirrors
    //    the autoFormatPrompt push in useApplySettingsToRust.
    const sysPrompt =
      latestModes.find((m) => m.id === next)?.systemPrompt ?? "";
    try {
      await invoke("cmd_set_auto_format_prompt", { prompt: sysPrompt });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[popo] cmd_set_auto_format_prompt failed:", err);
    }

    // 4. Hide the switcher + restore the caller's foreground window.
    try {
      await invoke("cmd_hide_mode_switcher");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[popo] switcher hide failed:", err);
    }
  }, []);

  const cancel = useCallback(async () => {
    try {
      await invoke("cmd_hide_mode_switcher");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[popo] switcher cancel failed:", err);
    }
  }, []);

  // Global keydown listener — fires regardless of which element
  // (or none) currently has focus inside the switcher webview.
  //
  // Why not the React `onKeyDown` on the outer div? Because that
  // only fires when focus is on a descendant. If the OS hands
  // keyboard focus to the webview but Chromium hasn't yet picked a
  // focused element (a ~one-frame race after `window.focus()`),
  // the React handler simply never fires for ESC. Result: the user
  // pressed Esc, nothing happened, and they had to click a mode
  // just to dismiss. Reported in Session 39.
  //
  // The window-level listener bypasses that race entirely. It also
  // means ESC works even if the user has clicked outside the search
  // input but inside the switcher card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void cancel();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (filtered.length === 0) return;
        setSelectedIdx((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (filtered.length === 0) return;
        setSelectedIdx((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        setSelectedIdx(0);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        if (filtered.length > 0) setSelectedIdx(filtered.length - 1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const mode = filtered[selectedIdx];
        if (mode) void pickMode(mode);
        return;
      }
      if (e.key === "Tab") {
        // Keep focus inside the search input — the switcher is modal.
        e.preventDefault();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, selectedIdx, pickMode, cancel]);

  // ── Render ───────────────────────────────────────────
  //
  // Design-system notes (Session 33 polish):
  //   - NO drop shadow (DESIGN_SYSTEM §0 bans box-shadow). popo reads
  //     as "carved from darkness" — shadows undermine that.
  //   - Card fills the window edge-to-edge. The previous 16 px outer
  //     gutter revealed the transparent window underneath (showing the
  //     user's apps behind the switcher), which looked like a broken
  //     halo. tauri.conf.json sizes the switcher window to match the
  //     card (480×380), so there's no unused transparent area.
  //   - Background uses `--pill-bg` + `--pill-blur` tokens (not a
  //     hardcoded rgba), matching the pill overlay's visual register.
  //     Both are overlay surfaces that sit on top of arbitrary desktop
  //     content — they should share the same "quiet floating panel" feel.
  //   - Border uses `--pill-border` for the same reason.
  return (
    <div
      // tabIndex={-1} makes the outer div programmatically focusable,
      // which gives Chromium a fallback focus target when the search
      // input hasn't yet received focus. Combined with the
      // window-level keydown listener above, ESC works in every
      // focus configuration we've seen.
      tabIndex={-1}
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        outline: "none",
      }}
    >
      <div
        role="dialog"
        aria-label="Quick mode switcher"
        style={{
          flex: 1,
          minHeight: 0,
          padding: "var(--sp-5)",
          background: "var(--pill-bg)",
          backdropFilter: "blur(var(--pill-blur))",
          WebkitBackdropFilter: "blur(var(--pill-blur))",
          border: "1px solid var(--pill-border)",
          borderRadius: "var(--radius-card)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-4)",
        }}
      >
        {/* Search input row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            height: 40,
            padding: "0 12px",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-button)",
          }}
        >
          <MagnifyingGlass
            size={14}
            weight="regular"
            color="var(--text-secondary)"
          />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search modes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            style={{
              flex: 1,
              height: "100%",
              border: "none",
              background: "transparent",
              outline: "none",
              fontFamily: "var(--font-pixel-square)",
              fontSize: "var(--text-sm)",
              color: "var(--text-primary)",
              padding: 0,
              minWidth: 0,
            }}
          />
          {filtered.length > 0 && (
            <span
              style={{
                fontFamily: "var(--font-pixel-grid)",
                fontSize: "var(--text-xs)",
                color: "var(--text-ghost)",
                flexShrink: 0,
              }}
            >
              {filtered.length}
              {search.trim() ? ` / ${modes.length}` : ""}
            </span>
          )}
        </div>

        {/* Mode list */}
        <div
          ref={listRef}
          role="listbox"
          aria-label="Modes"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            maxHeight: 260,
            overflowY: "auto",
            // Pull padding in so row highlight doesn't hug the card edge.
            margin: "0 calc(var(--sp-1) * -1)",
            paddingLeft: "var(--sp-1)",
            paddingRight: "var(--sp-1)",
          }}
        >
          {filtered.length === 0 ? (
            <div
              style={{
                padding: "var(--sp-5) var(--sp-3)",
                fontFamily: "var(--font-pixel-line)",
                fontSize: "var(--text-xs)",
                color: "var(--text-ghost)",
                textAlign: "center",
              }}
            >
              {modes.length === 0
                ? "No modes yet. Create one from the Modes page."
                : `No modes match "${search.trim()}".`}
            </div>
          ) : (
            filtered.map((mode, idx) => (
              <ModeRow
                key={mode.id}
                mode={mode}
                isDefault={mode.id === defaultModeId}
                selected={idx === selectedIdx}
                rowIndex={idx}
                iconsByName={iconsByName}
                onClick={() => void pickMode(mode)}
                onMouseEnter={() => setSelectedIdx(idx)}
              />
            ))
          )}
        </div>

        {/* Footer legend */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "var(--sp-4)",
            paddingTop: "var(--sp-2)",
            borderTop: "1px solid var(--border-faint)",
            fontFamily: "var(--font-pixel-grid)",
            fontSize: "var(--text-xs)",
            color: "var(--text-ghost)",
            flexWrap: "wrap",
          }}
        >
          <LegendItem>
            <KeyChip>↑</KeyChip>
            <KeyChip>↓</KeyChip>
            navigate
          </LegendItem>
          <LegendItem>
            <KeyChip>⏎</KeyChip>
            pick
          </LegendItem>
          <LegendItem>
            <KeyChip>Esc</KeyChip>
            cancel
          </LegendItem>
        </div>
      </div>
    </div>
  );
}

// ── Inline helpers ──────────────────────────────────────────────────

interface ModeRowProps {
  mode: Mode;
  isDefault: boolean;
  selected: boolean;
  rowIndex: number;
  iconsByName: Record<string, string>;
  onClick: () => void;
  onMouseEnter: () => void;
}

function ModeRow({
  mode,
  isDefault,
  selected,
  rowIndex,
  iconsByName,
  onClick,
  onMouseEnter,
}: ModeRowProps) {
  const [hovered, setHovered] = useState(false);
  const preview = mode.systemPrompt.slice(0, 60);
  const truncated = mode.systemPrompt.length > 60;

  const background = selected
    ? "var(--bg-high)"
    : hovered
      ? "var(--bg-elevated)"
      : "transparent";

  return (
    <div
      role="option"
      aria-selected={selected}
      data-row-idx={rowIndex}
      onClick={onClick}
      onMouseEnter={() => {
        setHovered(true);
        onMouseEnter();
      }}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        padding: "var(--sp-3)",
        // Reserve the 2px for the left edge stripe so the content
        // doesn't shift when selection moves between rows.
        paddingLeft: "calc(var(--sp-3) + 2px)",
        background,
        borderLeft: `2px solid ${
          selected ? "var(--text-primary)" : "transparent"
        }`,
        borderRadius: "var(--radius-micro)",
        cursor: "pointer",
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--sp-3)",
        transition: "background-color 120ms ease, border-color 120ms ease",
      }}
    >
      {/* Default marker column (keeps the layout stable either way) */}
      <span
        aria-hidden="true"
        style={{
          width: 14,
          marginTop: 2,
          flexShrink: 0,
          fontFamily: "var(--font-pixel-triangle)",
          fontSize: 8,
          color: isDefault ? "var(--text-ghost)" : "transparent",
          lineHeight: 1,
          textAlign: "center",
        }}
      >
        ◆
      </span>

      {/* Name + preview + app icons */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-pixel-square)",
            fontSize: "var(--text-base)",
            color: "var(--text-primary)",
            fontWeight: 500,
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {mode.name}
        </span>
        {preview && (
          <span
            style={{
              fontFamily: "var(--font-pixel-line)",
              fontSize: "var(--text-xs)",
              color: "var(--text-secondary)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              lineHeight: 1.3,
            }}
          >
            {preview}
            {truncated ? "…" : ""}
          </span>
        )}
        {mode.apps && mode.apps.length > 0 && (
          <span
            style={{ marginTop: 4, display: "inline-flex" }}
            title={mode.apps.join(", ")}
          >
            <AppIconStack appNames={mode.apps} iconsByName={iconsByName} />
          </span>
        )}
      </div>

      {/* Right column: hotkey chip */}
      {mode.hotkey && (
        <span
          style={{
            flexShrink: 0,
            marginTop: 2,
            fontFamily: "var(--font-pixel-grid)",
            fontSize: "var(--text-xs)",
            color: "var(--text-secondary)",
            padding: "2px 8px",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-badge)",
            whiteSpace: "nowrap",
          }}
        >
          {mode.hotkey}
        </span>
      )}
    </div>
  );
}

function LegendItem({ children }: { children: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      {children}
    </span>
  );
}

function KeyChip({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 18,
        height: 18,
        padding: "0 5px",
        marginRight: 4,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-micro)",
        fontFamily: "var(--font-pixel-grid)",
        fontSize: "var(--text-xs)",
        color: "var(--text-secondary)",
        lineHeight: 1,
      }}
    >
      {children}
    </span>
  );
}

interface AppIconStackProps {
  appNames: string[];
  iconsByName: Record<string, string>;
  maxVisible?: number;
}

/**
 * Local copy of ModeCard's AppIconStack. Kept inline (not shared) per
 * the spec — the switcher halo colour matches the switcher card bg,
 * not the main window card bg.
 */
function AppIconStack({
  appNames,
  iconsByName,
  maxVisible = 3,
}: AppIconStackProps) {
  const visible = appNames.slice(0, maxVisible);
  const overflow = appNames.length - visible.length;
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      {visible.map((name, i) => {
        const style: CSSProperties = {
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "var(--bg-surface)",
          // Halo matches the switcher card surface so stacked circles
          // read as overlapping chips against the dark overlay. Uses
          // the same --pill-bg token as the switcher card itself.
          outline: "1.5px solid var(--pill-bg)",
          overflow: "hidden",
          flexShrink: 0,
          marginLeft: i === 0 ? 0 : -5,
          zIndex: maxVisible - i,
        };
        return (
          <span key={name} title={name} style={style}>
            {iconsByName[name] ? (
              <img
                src={`data:image/png;base64,${iconsByName[name]}`}
                alt=""
                width={14}
                height={14}
                style={{ objectFit: "contain", display: "block" }}
              />
            ) : (
              <AppWindow size={9} weight="regular" color="var(--text-ghost)" />
            )}
          </span>
        );
      })}
      {overflow > 0 && (
        <span
          style={{
            marginLeft: 6,
            fontFamily: "var(--font-pixel-grid)",
            fontSize: "var(--text-xs)",
            color: "var(--text-secondary)",
          }}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}
