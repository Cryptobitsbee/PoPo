import { useState, type ComponentType } from "react";
import { X, Minus, type IconProps } from "@phosphor-icons/react";

/**
 * WindowControls — minimize + close buttons for the frameless main window.
 *
 * The brief doesn't explicitly prescribe window controls (§3 says "No top
 * header bar"), but a frameless window with no minimize/close is hostile
 * UX. We add two quiet 24×24 ghost buttons in the top-right corner.
 *
 * Behavior:
 *   Minimize → standard window minimize.
 *   Close    → HIDES the window (tray keeps the app alive). Right-click
 *              tray → Quit is the only way to fully exit popo.
 *
 * Drag-region opt-out: each button sets data-tauri-drag-region="false" so
 * mousedown on a button click-triggers it rather than dragging the window.
 */

export default function WindowControls() {
  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        right: 12,
        display: "flex",
        gap: 2,
        zIndex: 10,
      }}
    >
      <WindowButton
        label="Minimize"
        icon={Minus}
        onClick={handleMinimize}
      />
      <WindowButton label="Close" icon={X} onClick={handleHide} />
    </div>
  );
}

interface WindowButtonProps {
  label: string;
  icon: ComponentType<IconProps>;
  onClick: () => void | Promise<void>;
}

function WindowButton({ label, icon: Icon, onClick }: WindowButtonProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
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
        weight="regular"
        color={hovered ? "var(--text-primary)" : "var(--text-ghost)"}
        style={{ transition: "color 120ms ease" }}
      />
    </button>
  );
}

async function handleMinimize() {
  try {
    const { getCurrentWebviewWindow } = await import(
      "@tauri-apps/api/webviewWindow"
    );
    await getCurrentWebviewWindow().minimize();
  } catch {
    // Outside Tauri context — silently ignore.
  }
}

async function handleHide() {
  try {
    const { getCurrentWebviewWindow } = await import(
      "@tauri-apps/api/webviewWindow"
    );
    await getCurrentWebviewWindow().hide();
  } catch {
    // Outside Tauri context — silently ignore.
  }
}
