import { useEffect, useRef, useState } from "react";

/**
 * HotkeyInput — chip-based keyboard-shortcut capture input.
 *
 * Per brief §3 Settings HOTKEY INPUT:
 *   Shows chips: [Ctrl] + [Shift] + [Space]
 *   Chips: bg --bg-elevated, border --border-subtle, GeistPixelSquare --text-xs
 *   Click: border → --border-strong, shows "Press new shortcut…"
 *
 * Capture behaviour (Phase D wire-through):
 *   - Click the button → enters capture mode.
 *   - `keydown` listener on window builds the combo from current
 *     modifiers + the first non-modifier key pressed.
 *   - Escape cancels without committing.
 *   - When a non-modifier key arrives, we assemble the canonical
 *     string (e.g. "Ctrl+Shift+Space") and call `onChange`. The
 *     parent persists it via settingsStore.update({ hotkey }), which
 *     triggers useApplySettingsToRust to push it to Rust.
 *   - If Rust rejects the hotkey (unparseable or registration
 *     failed), the parent should surface the error; the HotkeyInput
 *     itself just captures and reports.
 *
 * Rules enforced during capture:
 *   - Must include at least ONE modifier for reliability. A bare
 *     single letter like "A" is rejected (captures conflict with
 *     typing); if the user types a letter alone, we show an error
 *     hint and stay in capture mode.
 *   - F1..F12 can be bound WITHOUT modifiers (they're already
 *     dedicated keys).
 *
 * `value` is the canonical hotkey string (e.g. "Ctrl+Shift+Space").
 */

export interface HotkeyInputProps {
  value: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
}

export default function HotkeyInput({
  value,
  onChange,
  disabled,
}: HotkeyInputProps) {
  const [capturing, setCapturing] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const rootRef = useRef<HTMLButtonElement | null>(null);

  // Reset hint when capture mode toggles.
  useEffect(() => {
    if (!capturing) setHint(null);
  }, [capturing]);

  // Capture keystrokes while in capture mode.
  useEffect(() => {
    if (!capturing) return;

    const handler = (e: KeyboardEvent) => {
      // Always swallow while capturing so Escape doesn't close any
      // surrounding popover / modal and letters don't type into
      // anything behind the button.
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels.
      if (e.key === "Escape") {
        setCapturing(false);
        setHint(null);
        return;
      }

      const keyToken = normaliseKey(e);
      if (keyToken === null) {
        // A modifier-only press (Shift, Ctrl, Alt, Meta). Not done yet;
        // wait for the user to add a real key.
        return;
      }

      const modifiers = collectModifiers(e);
      const isFunctionKey = /^F(\d+)$/.test(keyToken);

      if (modifiers.length === 0 && !isFunctionKey) {
        setHint(
          "Add a modifier (Ctrl / Alt / Shift / Win) or use a function key.",
        );
        return;
      }

      const combo = [...modifiers, keyToken].join("+");
      onChange?.(combo);
      setCapturing(false);
    };

    window.addEventListener("keydown", handler, { capture: true });
    return () =>
      window.removeEventListener("keydown", handler, { capture: true });
  }, [capturing, onChange]);

  const parts = parseHotkey(value);

  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 4,
      }}
    >
      <button
        ref={rootRef}
        type="button"
        aria-label="Keyboard shortcut"
        disabled={disabled}
        onClick={() => !disabled && setCapturing((v) => !v)}
        onBlur={() => setCapturing(false)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 32,
          padding: "0 10px",
          background: "transparent",
          border: `1px solid ${
            capturing ? "var(--border-strong)" : "transparent"
          }`,
          borderRadius: "var(--radius-button)",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          transition: "border-color 120ms ease",
        }}
      >
        {capturing ? (
          <span
            style={{
              fontFamily: "var(--font-pixel-line)",
              fontSize: "var(--text-xs)",
              color: "var(--text-ghost)",
              fontStyle: "italic",
            }}
          >
            Press new shortcut…
          </span>
        ) : (
          parts.map((part, i) => (
            <span
              key={`${part}-${i}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Kbd>{part}</Kbd>
              {i < parts.length - 1 && (
                <span
                  style={{
                    fontFamily: "var(--font-pixel-grid)",
                    fontSize: "var(--text-xs)",
                    color: "var(--text-ghost)",
                  }}
                >
                  +
                </span>
              )}
            </span>
          ))
        )}
      </button>

      {hint ? (
        <div
          style={{
            fontFamily: "var(--font-pixel-line)",
            fontSize: "var(--text-xs)",
            color: "var(--accent-warn, var(--text-ghost))",
            maxWidth: 260,
            textAlign: "right",
          }}
        >
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0 6px",
        height: 20,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-micro)",
        fontFamily: "var(--font-pixel-square)",
        fontSize: "var(--text-xs)",
        lineHeight: 1.2,
        color: "var(--text-primary)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </kbd>
  );
}

/** "Ctrl+Shift+Space" → ["Ctrl", "Shift", "Space"]. */
function parseHotkey(value: string): string[] {
  if (!value) return ["—"];
  return value
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
}

// ─── Key event → canonical token ──────────────────────────────────

function collectModifiers(e: KeyboardEvent): string[] {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Win");
  return mods;
}

/**
 * Convert a KeyboardEvent to a canonical non-modifier token, or
 * return `null` if the key IS a modifier (incomplete combo).
 *
 * Uses `event.code` (layout-independent) for letters/digits so
 * "A" on QWERTY and "Q" on AZERTY both bind to the same key cap.
 */
function normaliseKey(e: KeyboardEvent): string | null {
  const code = e.code;

  // Modifier-only presses — not a complete combo yet.
  if (
    code === "ShiftLeft" ||
    code === "ShiftRight" ||
    code === "ControlLeft" ||
    code === "ControlRight" ||
    code === "AltLeft" ||
    code === "AltRight" ||
    code === "MetaLeft" ||
    code === "MetaRight"
  ) {
    return null;
  }

  // Letter keys.
  const letterMatch = /^Key([A-Z])$/.exec(code);
  if (letterMatch) return letterMatch[1];

  // Digit keys (main row — "Digit0" .. "Digit9").
  const digitMatch = /^Digit(\d)$/.exec(code);
  if (digitMatch) return digitMatch[1];

  // Function keys.
  if (/^F\d+$/.test(code)) return code;

  // Named keys we understand.
  switch (code) {
    case "Space":
      return "Space";
    case "Enter":
    case "NumpadEnter":
      return "Enter";
    case "Tab":
      return "Tab";
    case "Escape":
      return "Escape";
    case "Backspace":
      return "Backspace";
    case "Delete":
      return "Delete";
    case "Insert":
      return "Insert";
    case "Home":
      return "Home";
    case "End":
      return "End";
    case "PageUp":
      return "PageUp";
    case "PageDown":
      return "PageDown";
    case "ArrowUp":
      return "Up";
    case "ArrowDown":
      return "Down";
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    case "Comma":
      return "Comma";
    case "Period":
      return "Period";
    case "Slash":
      return "Slash";
    case "Backslash":
      return "Backslash";
    case "Semicolon":
      return "Semicolon";
    case "Quote":
      return "Quote";
    case "Minus":
      return "Minus";
    case "Equal":
      return "Equal";
    case "BracketLeft":
      return "BracketLeft";
    case "BracketRight":
      return "BracketRight";
    case "Backquote":
      return "Backquote";
    default:
      // Unknown code — fall back to the value so the user at least
      // gets a best-effort binding. Rust parse will reject it if
      // unsupported.
      return e.key.length === 1 ? e.key.toUpperCase() : e.key;
  }
}
