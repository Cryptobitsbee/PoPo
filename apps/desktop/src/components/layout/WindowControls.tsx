import { useEffect, useState, type ComponentType } from "react";
import { X, Minus, Square, type IconProps } from "@phosphor-icons/react";

/**
 * WindowControls — minimize + maximize/restore + close buttons for the
 * frameless main window.
 *
 * The brief doesn't explicitly prescribe window controls (§3 says "No top
 * header bar"), but a frameless window with no minimize/close is hostile
 * UX. We add three quiet 24×24 ghost buttons in the top-right corner.
 *
 * Behavior:
 *   Minimize         → standard window minimize.
 *   Maximize/Restore → toggleMaximize() — swaps icon based on state.
 *   Close            → HIDES the window (tray keeps the app alive).
 *                      Right-click tray → Quit is the only way to fully
 *                      exit popo.
 *
 * Drag-region opt-out: each button sets data-tauri-drag-region="false" so
 * mousedown on a button click-triggers it rather than dragging the window.
 *
 * Z-index 200 (Session 56): explicitly above Modal's backdrop (zIndex
 * 100). Without this, opening a Mode editor / Snippet editor / GCP
 * wizard / etc. would hide the controls behind the backdrop, and the
 * user couldn't minimize/close the app while a modal was open.
 * Window controls are SYSTEM-LEVEL affordances; they should always be
 * accessible regardless of what content layer is in front.
 */

export default function WindowControls() {
  // Track maximize state so the middle button can swap icon between
  // "maximize" (square) and "restore" (stacked squares). Polls Tauri
  // on mount + listens to the resize event.
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let unlistenResize: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const { getCurrentWebviewWindow } =
          await import("@tauri-apps/api/webviewWindow");
        const win = getCurrentWebviewWindow();
        const initial = await win.isMaximized();
        if (!cancelled) setIsMaximized(initial);

        // Tauri's "tauri://resize" fires on every window-size change,
        // including the user double-clicking the title bar / hitting
        // Win+Up / Win+Down / dragging window edges. We just re-poll
        // isMaximized() after each resize.
        const fn = await win.onResized(async () => {
          try {
            const next = await win.isMaximized();
            if (!cancelled) setIsMaximized(next);
          } catch {
            // ignore — outside Tauri or window destroyed
          }
        });
        if (cancelled) {
          fn();
          return;
        }
        unlistenResize = fn;
      } catch {
        // Outside Tauri context — leave isMaximized at false. The
        // toggle button still renders (and no-ops on click).
      }
    })();

    return () => {
      cancelled = true;
      unlistenResize?.();
    };
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        right: 12,
        display: "flex",
        gap: 2,
        // Above Modal's backdrop (z-index 100) so controls are
        // always reachable. Session 56.
        zIndex: 200,
      }}
    >
      <WindowButton label="Minimize" icon={Minus} onClick={handleMinimize} />
      <WindowButton
        label={isMaximized ? "Restore" : "Maximize"}
        // Custom restore icon when maximized (canonical Windows
        // overlapping-squares glyph); plain Square when not.
        icon={isMaximized ? RestoreIcon : Square}
        onClick={handleToggleMaximize}
        // Square is filled in Phosphor's regular weight by default,
        // so we tweak it to be just the outline via iconWeight.
        iconWeight="regular"
      />
      <WindowButton label="Close" icon={X} onClick={handleHide} />
    </div>
  );
}

interface WindowButtonProps {
  label: string;
  icon: ComponentType<IconProps>;
  onClick: () => void | Promise<void>;
  iconWeight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
}

function WindowButton({
  label,
  icon: Icon,
  onClick,
  iconWeight = "regular",
}: WindowButtonProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // Explicit drag opt-out so mousedown doesn't start a drag.
      data-tauri-drag-region="false"
      style={{
        width: 24,
        height: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        background: hovered ? "var(--bg-elevated)" : "transparent",
        border: "none",
        borderRadius: "var(--radius-micro)",
        cursor: "pointer",
        transition: "background-color 120ms ease",
      }}
    >
      <Icon
        size={12}
        weight={iconWeight}
        // Session 55 hierarchy: secondary at rest, primary on hover.
        color={hovered ? "var(--text-primary)" : "var(--text-secondary)"}
        style={{ transition: "color 120ms ease" }}
      />
    </button>
  );
}

/**
 * Custom "restore" icon — canonical Windows two-overlapping-squares
 * glyph. Phosphor doesn't have a 1:1 match for this convention, so
 * we render a minimal SVG inline. Sized + colored to match the
 * rest of the WindowButton icons (12 px, currentColor).
 */
function RestoreIcon({ size = 12, color, style }: IconProps) {
  const px = typeof size === "number" ? size : 12;
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
      aria-hidden="true"
    >
      {/* Back square — partially obscured by the front square. */}
      <path
        d="M5.5 3.5 H 13 V 11"
        stroke={color ?? "currentColor"}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Front square. */}
      <rect
        x="3"
        y="5.5"
        width="8"
        height="8"
        rx="0.5"
        stroke={color ?? "currentColor"}
        strokeWidth={1.3}
      />
    </svg>
  );
}

async function handleMinimize() {
  try {
    const { getCurrentWebviewWindow } =
      await import("@tauri-apps/api/webviewWindow");
    await getCurrentWebviewWindow().minimize();
  } catch {
    // Outside Tauri context — silently ignore.
  }
}

async function handleToggleMaximize() {
  try {
    const { getCurrentWebviewWindow } =
      await import("@tauri-apps/api/webviewWindow");
    await getCurrentWebviewWindow().toggleMaximize();
  } catch {
    // Outside Tauri context — silently ignore.
  }
}

async function handleHide() {
  try {
    const { getCurrentWebviewWindow } =
      await import("@tauri-apps/api/webviewWindow");
    await getCurrentWebviewWindow().hide();
  } catch {
    // Outside Tauri context — silently ignore.
  }
}
