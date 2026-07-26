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
 * Build the `cmd_set_mode_bindings` payload from the latest mode snapshot.
 * The switcher does not mount useApplySettingsToRust, so a pick must push
 * its own binding update directly to Rust.
 */
function buildModeBindingsPayload(
  modes: Mode[],
  defaultModeId: string | null | undefined,
) {
  return modes.map((mode) => ({
    id: mode.id,
    name: mode.name,
    systemPrompt: mode.systemPrompt,
    apps: mode.apps ?? [],
    isDefault: defaultModeId
      ? mode.id === defaultModeId
      : !!mode.isDefault,
    hotkey: (mode.hotkey ?? "").trim(),
    soundPreset: mode.soundPreset ?? "default",
  }));
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
      useSettingsStore.getState().update({ defaultModeId: next });

      const latestModes = useModesStore.getState().modes;
      const payload = buildModeBindingsPayload(latestModes, next);
      try {
        await invoke("cmd_set_mode_bindings", { bindings: payload });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[popo] cmd_set_mode_bindings failed:", error);
      }

      const systemPrompt =
        latestModes.find((candidate) => candidate.id === next)?.systemPrompt ??
        "";
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

      {mode.hotkey?.trim() && (
        <KeyChip>{mode.hotkey.trim()}</KeyChip>
      )}
    </div>
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
