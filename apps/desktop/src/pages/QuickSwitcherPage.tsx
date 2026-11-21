import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, MagnifyingGlass } from "@phosphor-icons/react";
import type { Mode } from "@popo/shared-types";
import { useModesStore } from "../store/modesStore";
import { useAppIconsStore } from "../store/appIconsStore";
import { useSettingsStore } from "../store/settingsStore";
import {
  rehydrateSettings,
  rehydrateModes,
  subscribeCrossWebview,
  SETTINGS_CHANGED_EVENT,
  MODES_CHANGED_EVENT,
} from "../lib/cross-webview-sync";

/**
 * Re-hydrate the switcher's stores from shared localStorage. Tauri runs
 * each webview in its own JS process, so store changes in the main window
 * do not otherwise reach this persistent webview.
 */
function rehydrateFromLocalStorage(): void {
  rehydrateSettings();
  rehydrateModes();
}

/**
 * Compact Ctrl+Shift+M mode selector. Rust owns the transparent,
 * always-on-top window lifecycle and restores the caller's foreground
 * HWND when the selector closes.
 */
export default function QuickSwitcherPage() {
  const modes = useModesStore((state) => state.modes);
  const defaultModeId = useSettingsStore(
    (state) => state.settings.defaultModeId,
  );
  const autoFormat = useSettingsStore((state) => state.settings.autoFormat);

  const [search, setSearch] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Default first, then usage count, then creation order.
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
    const query = search.trim().toLowerCase();
    if (!query) return sorted;
    return sorted.filter(
      (mode) =>
        mode.name.toLowerCase().includes(query) ||
        mode.systemPrompt.toLowerCase().includes(query),
    );
  }, [sorted, search]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [search]);

  useEffect(() => {
    if (selectedIdx >= filtered.length) {
      setSelectedIdx(filtered.length > 0 ? filtered.length - 1 : 0);
    }
  }, [filtered.length, selectedIdx]);

  // The webview persists across hides. Reset and rehydrate on every show.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      rehydrateFromLocalStorage();
      setSearch("");
      setSelectedIdx(0);
      window.focus();
      window.setTimeout(() => searchRef.current?.focus(), 20);
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    rehydrateFromLocalStorage();
    window.focus();
    searchRef.current?.focus();
  }, []);

  // Keep settings and modes current while this webview is visible.
  useEffect(() => {
    let unlistenSettings: (() => void) | null = null;
    let unlistenModes: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      const settingsListener = await subscribeCrossWebview(
        SETTINGS_CHANGED_EVENT,
        rehydrateSettings,
      );
      const modesListener = await subscribeCrossWebview(
        MODES_CHANGED_EVENT,
        rehydrateModes,
      );

      if (cancelled) {
        settingsListener();
        modesListener();
        return;
      }

      unlistenSettings = settingsListener;
      unlistenModes = modesListener;
    })();

    return () => {
      cancelled = true;
      unlistenSettings?.();
      unlistenModes?.();
    };
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(
      `[data-row-idx="${selectedIdx}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const pickMode = useCallback(
    async (mode: Mode) => {
      // Auto-format is the master switch. Keep the saved default dormant
      // while disabled and emit no binding or prompt IPC updates.
      if (!autoFormat) return;

      const next = mode.id;

      // One-shot override for the NEXT dictation, and nothing else.
      //
      // resolve_mode ranks an app binding (priority 2) above the default
      // mode (priority 3), so the old approach of setting defaultModeId
      // had no effect at all in any app that had a binding: dictating in
      // Zed kept using Code however clearly the switcher checkmarked
      // Auto. The UI asserted a state the engine ignored.
      //
      // priority 1 (`pending_forced_mode_id`) exists in Rust for exactly
      // this and had no caller anywhere in the frontend. on_press reads it
      // with `g.take()`, so it is consumed by one dictation and then gone.
      //
      // Deliberately NOT writing defaultModeId any more. An app binding is
      // a standing RULE ("in Zed, always Code"); opening the switcher is a
      // momentary EXCEPTION ("not this time"). An exception must outrank
      // the rule but must not quietly rewrite your saved configuration —
      // reaching for a quick override should not change what tomorrow
      // looks like. Settings -> Formatting mode remains the one place that
      // changes your default.
      try {
        await invoke("cmd_set_pending_forced_mode", { modeId: next });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[popo] cmd_set_pending_forced_mode failed:", error);
      }

      const systemPrompt =
        useModesStore
          .getState()
          .modes.find((candidate) => candidate.id === next)?.systemPrompt ?? "";
      try {
        await invoke("cmd_set_auto_format_prompt", { prompt: systemPrompt });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[popo] cmd_set_auto_format_prompt failed:", error);
      }

      try {
        await invoke("cmd_hide_mode_switcher");
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[popo] switcher hide failed:", error);
      }
    },
    [autoFormat],
  );

  const cancel = useCallback(async () => {
    try {
      await invoke("cmd_hide_mode_switcher");
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn("[popo] switcher cancel failed:", error);
    }
  }, []);

  // Window-level handling avoids the one-frame Chromium focus race after
  // Windows foregrounds the transparent Tauri webview.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void cancel();
        return;
      }
      if (!autoFormat) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (filtered.length > 0) {
          setSelectedIdx((index) => (index + 1) % filtered.length);
        }
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (filtered.length > 0) {
          setSelectedIdx(
            (index) => (index - 1 + filtered.length) % filtered.length,
          );
        }
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setSelectedIdx(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        if (filtered.length > 0) setSelectedIdx(filtered.length - 1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const mode = filtered[selectedIdx];
        if (mode) void pickMode(mode);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [autoFormat, cancel, filtered, pickMode, selectedIdx]);

  return (
    <div
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
          padding: "var(--sp-3)",
          background: "var(--pill-bg)",
          backdropFilter: "blur(var(--pill-blur))",
          WebkitBackdropFilter: "blur(var(--pill-blur))",
          border: "1px solid var(--pill-border)",
          borderRadius: "var(--radius-card)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-2)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-2)",
            height: 34,
            padding: "0 var(--sp-3)",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-button)",
            flexShrink: 0,
          }}
        >
          <MagnifyingGlass
            size={13}
            weight="regular"
            color="var(--text-secondary)"
            aria-hidden="true"
          />
          <input
            ref={searchRef}
            type="text"
            aria-label="Search modes"
            placeholder="Search modes"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            style={{
              flex: 1,
              height: "100%",
              minWidth: 0,
              padding: 0,
              border: "none",
              background: "transparent",
              outline: "none",
              fontFamily: "var(--font-pixel-square)",
              fontSize: "var(--text-sm)",
              color: "var(--text-primary)",
            }}
          />
          {search.trim() && (
            <span
              aria-label={`${filtered.length} matching modes`}
              style={{
                flexShrink: 0,
                fontFamily: "var(--font-pixel-grid)",
                fontSize: "var(--text-xs)",
                color: "var(--text-ghost)",
              }}
            >
              {filtered.length}
            </span>
          )}
        </div>

        <div
          ref={listRef}
          role="listbox"
          aria-label="Modes"
          aria-disabled={!autoFormat}
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            overflowY: "auto",
            paddingRight: 2,
          }}
        >
          {filtered.length === 0 ? (
            <div
              style={{
                margin: "auto",
                padding: "var(--sp-4) var(--sp-3)",
                fontFamily: "var(--font-pixel-line)",
                fontSize: "var(--text-xs)",
                color: "var(--text-ghost)",
                textAlign: "center",
              }}
            >
              {modes.length === 0
                ? "Create a mode in the Modes page"
                : "No matching modes"}
            </div>
          ) : (
            filtered.map((mode, index) => (
              <ModeRow
                key={mode.id}
                mode={mode}
                isDefault={autoFormat && mode.id === defaultModeId}
                selected={autoFormat && index === selectedIdx}
                disabled={!autoFormat}
                rowIndex={index}
                onClick={() => void pickMode(mode)}
                onMouseEnter={() => {
                  if (autoFormat) setSelectedIdx(index);
                }}
              />
            ))
          )}
        </div>

        <div
          style={{
            minHeight: 24,
            paddingTop: "var(--sp-2)",
            borderTop: "1px solid var(--border-faint)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--sp-2)",
            flexShrink: 0,
            whiteSpace: "nowrap",
            fontFamily: "var(--font-pixel-grid)",
            fontSize: "var(--text-xs)",
            color: "var(--text-ghost)",
          }}
        >
          {autoFormat ? (
            <>
              <FooterAction keys="↑↓">move</FooterAction>
              <span aria-hidden="true">·</span>
              <FooterAction keys="Enter">select</FooterAction>
              <span aria-hidden="true">·</span>
              <FooterAction keys="Esc">close</FooterAction>
            </>
          ) : (
            <>
              <span style={{ color: "var(--text-secondary)" }}>
                Auto-format is off
              </span>
              <span aria-hidden="true">·</span>
              <FooterAction keys="Esc">close</FooterAction>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface ModeRowProps {
  mode: Mode;
  isDefault: boolean;
  selected: boolean;
  disabled: boolean;
  rowIndex: number;
  onClick: () => void;
  onMouseEnter: () => void;
}

function ModeRow({
  mode,
  isDefault,
  selected,
  disabled,
  rowIndex,
  onClick,
  onMouseEnter,
}: ModeRowProps) {
  const [hovered, setHovered] = useState(false);
  const background = selected
    ? "var(--bg-high)"
    : hovered
      ? "var(--bg-elevated)"
      : "transparent";

  return (
    <div
      role="option"
      aria-label={`${mode.name}${isDefault ? ", active mode" : ""}`}
      aria-selected={disabled ? false : selected}
      aria-disabled={disabled}
      data-row-idx={rowIndex}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => {
        if (disabled) return;
        setHovered(true);
        onMouseEnter();
      }}
      onMouseLeave={() => setHovered(false)}
      style={{
        minHeight: 38,
        padding: "0 var(--sp-2)",
        background,
        border: `1px solid ${
          selected ? "var(--border-default)" : "transparent"
        }`,
        borderRadius: "var(--radius-button)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.46 : 1,
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-2)",
        transition:
          "background-color 150ms ease-out, border-color 150ms ease-out, opacity 150ms ease-out",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 14,
          height: 14,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: isDefault ? "var(--text-secondary)" : "transparent",
        }}
      >
        <Check size={12} weight="regular" />
      </span>

      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: "var(--font-pixel-circle)",
          fontSize: "var(--text-sm)",
          color: "var(--text-primary)",
          lineHeight: 1.2,
        }}
      >
        {mode.name}
      </span>

      {/*
        Apps bound to this mode.
        ────────────────────────
        Without this the switcher shows a checkmark against your default
        and nothing else, so there is no way to tell that the mode which
        will ACTUALLY run was decided by an app binding. That is exactly
        the confusion worth removing: seeing Zed's icon on the Code row
        explains, at a glance, why dictating in Zed uses Code no matter
        what the checkmark says.

        Capped at three, with a +N overflow, because a mode bound to a
        dozen apps would otherwise push the name out of the row.
      */}
      <BoundApps apps={mode.apps} />

      {mode.hotkey?.trim() && <KeyChip>{mode.hotkey.trim()}</KeyChip>}
    </div>
  );
}

/** Max icons shown inline before collapsing into a +N chip. */
const MAX_BOUND_ICONS = 3;

/**
 * Row of app icons for the apps bound to a mode.
 *
 * Falls back to a plain text count when we have no cached icon for an
 * app: icons are harvested opportunistically from windows you have
 * actually dictated into, so a freshly configured binding may have no
 * bitmap yet. Showing nothing in that case would misrepresent the mode
 * as unbound, which is the very thing this row exists to prevent.
 */
function BoundApps({ apps }: { apps: string[] | undefined }) {
  const iconsByName = useAppIconsStore((s) => s.iconsByName);
  if (!apps || apps.length === 0) return null;

  // `iconFor` is an exact key match, but Rust resolves bindings
  // case-insensitively (`a.to_lowercase() == app_lower` in resolve_mode).
  // So a binding stored as "zed" would never find an icon cached under
  // "Zed" and would silently render as a letter tile. Match the engine's
  // leniency here rather than depend on the two spellings agreeing.
  const lookup = (app: string): string | undefined => {
    const exact = iconsByName[app];
    if (exact) return exact;
    const target = app.toLowerCase();
    const hit = Object.keys(iconsByName).find(
      (key) => key.toLowerCase() === target,
    );
    return hit ? iconsByName[hit] : undefined;
  };

  const shown = apps.slice(0, MAX_BOUND_ICONS);
  const overflow = apps.length - shown.length;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        flexShrink: 0,
      }}
      title={`Used automatically in: ${apps.join(", ")}`}
    >
      {shown.map((app) => {
        // The store holds RAW base64, not a data URL — every other
        // consumer (SessionRow, ModeCard, AppIconBubble, AppPicker) wraps
        // it the same way. Passing the bare string to `src` silently
        // fails to load and falls through to the letter tile below, which
        // is exactly what happened on the first attempt here.
        const b64 = lookup(app);
        return b64 ? (
          <img
            key={app}
            src={`data:image/png;base64,${b64}`}
            alt=""
            width={13}
            height={13}
            draggable={false}
            style={{ display: "block", borderRadius: 2, opacity: 0.85 }}
          />
        ) : (
          <span
            key={app}
            aria-hidden
            style={{
              width: 13,
              height: 13,
              borderRadius: 2,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--bg-high)",
              fontFamily: "var(--font-pixel-grid)",
              fontSize: 8,
              color: "var(--text-ghost)",
            }}
          >
            {app.slice(0, 1).toUpperCase()}
          </span>
        );
      })}
      {overflow > 0 && (
        <span
          style={{
            fontFamily: "var(--font-pixel-grid)",
            fontSize: "var(--text-2xs)",
            color: "var(--text-ghost)",
          }}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}

function FooterAction({
  keys,
  children,
}: {
  keys: string;
  children: ReactNode;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <KeyChip>{keys}</KeyChip>
      <span>{children}</span>
    </span>
  );
}

function KeyChip({ children }: { children: ReactNode }) {
  return (
    <kbd
      style={{
        minWidth: 18,
        height: 18,
        padding: "0 var(--sp-1)",
        boxSizing: "border-box",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-micro)",
        fontFamily: "var(--font-pixel-grid)",
        fontSize: "var(--text-xs)",
        fontWeight: 400,
        color: "var(--text-secondary)",
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </kbd>
  );
}
