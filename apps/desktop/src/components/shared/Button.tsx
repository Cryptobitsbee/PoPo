import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

/**
 * Button — the 3-variant action button per DESIGN_SYSTEM §9.
 *
 *   ghost:   text --text-secondary, hover --text-primary, no bg
 *   subtle:  bg --bg-elevated, border --border-subtle, hover border --border-default
 *   primary: bg --bg-high, border --border-default, text --text-primary
 *
 * Font: GeistPixelSquare --text-sm · radius --radius-button · px-4 py-2.
 *
 * Not for window controls (see WindowControls.tsx — those are 24px
 * icon-only). Not for NavItems (see NavItem.tsx). This is the standard
 * "do an action" button used in Settings, Modes, Test, GCP Setup, etc.
 */

export type ButtonVariant = "ghost" | "subtle" | "primary";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
}

export default function Button({
  variant = "subtle",
  iconLeft,
  iconRight,
  fullWidth,
  children,
  style,
  disabled,
  ...rest
}: ButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  const isDisabled = disabled === true;

  const variantStyles = getVariantStyles(variant, {
    hovered: hovered && !isDisabled,
    pressed: pressed && !isDisabled,
  });

  return (
    <button
      {...rest}
      disabled={isDisabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        height: 32,
        padding: "0 16px",
        width: fullWidth ? "100%" : undefined,
        fontFamily: "var(--font-pixel-square)",
        fontSize: "var(--text-sm)",
        lineHeight: 1.2,
        borderRadius: "var(--radius-button)",
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled ? 0.5 : 1,
        transition:
          "background-color 120ms ease, border-color 120ms ease, color 120ms ease",
        ...variantStyles,
        ...style,
      }}
    >
      {iconLeft && <span style={{ display: "inline-flex" }}>{iconLeft}</span>}
      <span>{children}</span>
      {iconRight && <span style={{ display: "inline-flex" }}>{iconRight}</span>}
    </button>
  );
}

function getVariantStyles(
  variant: ButtonVariant,
  states: { hovered: boolean; pressed: boolean },
): React.CSSProperties {
  switch (variant) {
    case "ghost":
      return {
        background: "transparent",
        border: "1px solid transparent",
        color: states.hovered ? "var(--text-primary)" : "var(--text-secondary)",
      };
    case "primary":
      return {
        background: states.pressed ? "var(--bg-elevated)" : "var(--bg-high)",
        border: `1px solid ${
          states.hovered ? "var(--border-strong)" : "var(--border-default)"
        }`,
        color: "var(--text-primary)",
      };
    case "subtle":
    default:
      return {
        background: states.pressed ? "var(--bg-high)" : "var(--bg-elevated)",
        border: `1px solid ${
          states.hovered ? "var(--border-default)" : "var(--border-subtle)"
        }`,
        color: states.hovered ? "var(--text-primary)" : "var(--text-secondary)",
      };
  }
}
