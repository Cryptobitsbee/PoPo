import { useState, type ComponentType, type MouseEvent } from "react";
import { AppWindow, Copy, Trash, type IconProps } from "@phosphor-icons/react";
import type { Mode } from "@popo/shared-types";
import Chip from "../shared/Chip";
import { useAppIconsStore } from "../../store/appIconsStore";
import { useSettingsStore } from "../../store/settingsStore";

/**
 * ModeCard — a single card in the 2-column Modes grid.
 *
 * Per brief §3 Modes MODE CARD:
 *   bg --bg-surface · border 1px --border-subtle · radius --radius-card
 *   padding --sp-6 · min-height 120px
 *   Hover: border --border-default · bg --bg-elevated (180ms ease)
 *
 *   Name:   GeistPixelSquare --text-base --text-primary
 *   Prompt: GeistPixelLine   --text-sm   --text-secondary · 3-line clamp
 *   Footer: [language chip] · "N uses"  GeistPixelGrid --text-xs
 *   Default marker: ◆ GeistPixelTriangle 8px --text-ghost (top-right)
 *   Hover actions: Copy (duplicate) + Delete (top-right)
 */

export interface ModeCardProps {
  mode: Mode;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export default function ModeCard({
  mode,
  onEdit,
  onDuplicate,
  onDelete,
}: ModeCardProps) {
  const [hovered, setHovered] = useState(false);
  const iconsByName = useAppIconsStore((s) => s.iconsByName);
  // Session 37 fix: the default-mode ◆ marker reads from
  // settingsStore.defaultModeId, NOT mode.isDefault. SEED_MODES bakes
  // `isDefault: true` on Auto as a first-install fallback, so the old
  // `mode.isDefault` check showed the marker on Auto forever even
  // after the user picked a different default. Match the Rust
  // resolution logic: settings.defaultModeId wins when set.
  const defaultModeId = useSettingsStore((s) => s.settings.defaultModeId);
  const isCurrentDefault = defaultModeId
    ? mode.id === defaultModeId
    : mode.isDefault;

  return (
    <article
      onClick={onEdit}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        minHeight: 120,
        padding: "var(--sp-6)",
        background: hovered ? "var(--bg-elevated)" : "var(--bg-surface)",
        border: `1px solid ${
          hovered ? "var(--border-default)" : "var(--border-subtle)"
        }`,
        borderRadius: "var(--radius-card)",
        display: "flex",
        flexDirection: "column",
        cursor: "pointer",
        transition: "background-color 180ms ease, border-color 180ms ease",
      }}
    >
      {/* Default indicator (shows when NOT hovered so it doesn't fight with action icons) */}
      {isCurrentDefault && !hovered && (
        <span
          aria-label="Default mode"
          title="Default mode"
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            fontFamily: "var(--font-pixel-triangle)",
            fontSize: 8,
            color: "var(--text-ghost)",
            pointerEvents: "none",
            lineHeight: 1,
          }}
        >
          ◆
        </span>
      )}

      {/* Hover-revealed actions (top-right) */}
      <div
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          display: "flex",
          gap: 2,
          opacity: hovered ? 1 : 0,
          transition: "opacity 120ms ease",
          pointerEvents: hovered ? "auto" : "none",
        }}
      >
        <CardAction icon={Copy} label="Duplicate mode" onClick={onDuplicate} />
        <CardAction
          icon={Trash}
          label="Delete mode"
          onClick={onDelete}
          destructive
        />
      </div>

      {/* Name */}
      <h3
        style={{
          margin: 0,
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-base)",
          fontWeight: 500,
          lineHeight: 1.3,
          color: "var(--text-primary)",
          // Right padding makes room for the default marker / hover actions.
          paddingRight: 32,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {mode.name}
      </h3>

      {/* Prompt preview — 3-line clamp per brief */}
      <p
        style={{
          marginTop: "var(--sp-2)",
          marginBottom: 0,
          fontFamily: "var(--font-pixel-line)",
          fontSize: "var(--text-sm)",
          lineHeight: 1.4,
          color: "var(--text-secondary)",
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 3,
          overflow: "hidden",
        }}
      >
        {mode.systemPrompt}
      </p>

      {/* Footer */}
      <div
        style={{
          marginTop: "auto",
          paddingTop: "var(--sp-4)",
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          fontFamily: "var(--font-pixel-grid)",
          fontSize: "var(--text-xs)",
          color: "var(--text-secondary)",
          flexWrap: "wrap",
        }}
      >
        <Chip>{mode.language ?? "any language"}</Chip>
        {mode.translateTo && (
          <>
            <span style={{ color: "var(--text-ghost)" }}>·</span>
            <Chip>
              {/* Translation badge — e.g. "→ Hindi" — makes it
                  unmistakable at a glance which modes translate.
                  Session 51 — feature #12. */}
              → {translateLabel(mode.translateTo)}
            </Chip>
          </>
        )}
        <span style={{ color: "var(--text-ghost)" }}>·</span>
        <span>
          {mode.usageCount} {mode.usageCount === 1 ? "use" : "uses"}
        </span>
        <span style={{ color: "var(--text-ghost)" }}>·</span>
        <span>{formatOutputFormat(mode.outputFormat)}</span>
        {mode.apps && mode.apps.length > 0 && (
          <>
            <span style={{ color: "var(--text-ghost)" }}>·</span>
            <span
              title={mode.apps.join(", ")}
              style={{
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              <AppIconStack appNames={mode.apps} iconsByName={iconsByName} />
            </span>
          </>
        )}
      </div>
    </article>
  );
}

interface AppIconStackProps {
  appNames: string[];
  iconsByName: Record<string, string>;
  maxVisible?: number;
}

function AppIconStack({
  appNames,
  iconsByName,
  maxVisible = 3,
}: AppIconStackProps) {
  const visible = appNames.slice(0, maxVisible);
  const overflow = appNames.length - visible.length;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      {visible.map((name, i) => (
        <AppAvatar
          key={name}
          name={name}
          iconBase64={iconsByName[name]}
          style={{
            marginLeft: i === 0 ? 0 : -6,
            zIndex: maxVisible - i,
          }}
        />
      ))}
      {overflow > 0 && (
        <span
          style={{
            marginLeft: 4,
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

interface AppAvatarProps {
  name: string;
  iconBase64?: string;
  style?: React.CSSProperties;
}

function AppAvatar({ name, iconBase64, style }: AppAvatarProps) {
  return (
    <span
      title={name}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: "var(--bg-surface)",
        // 1.5px halo against the card background — makes stacked
        // circles read as overlapping chips rather than a blob.
        outline: "1.5px solid var(--bg-surface)",
        overflow: "hidden",
        flexShrink: 0,
        position: "relative",
        ...style,
      }}
    >
      {iconBase64 ? (
        <img
          src={`data:image/png;base64,${iconBase64}`}
          alt=""
          width={16}
          height={16}
          style={{ objectFit: "contain", display: "block" }}
        />
      ) : (
        <AppWindow size={10} weight="regular" color="var(--text-ghost)" />
      )}
    </span>
  );
}

function formatOutputFormat(f: Mode["outputFormat"]): string {
  switch (f) {
    case "paragraph":
      return "paragraph";
    case "bullets":
      return "bullets";
    case "raw":
      return "raw";
    default:
      return f;
  }
}

/**
 * Short display label for a `translateTo` BCP-47 code, e.g.
 *   "hi-IN" → "Hindi"
 *   "en-US" → "English"
 *   "es-ES" → "Spanish"
 *
 * Falls back to the raw code for unknown values so misconfigured
 * modes still render readably. Session 51 — feature #12.
 */
function translateLabel(code: string): string {
  switch (code) {
    case "en-US":
    case "en-GB":
    case "en-IN":
      return "English";
    case "hi-IN":
      return "Hindi";
    case "te-IN":
      return "Telugu";
    case "ta-IN":
      return "Tamil";
    case "bn-IN":
      return "Bengali";
    case "mr-IN":
      return "Marathi";
    case "es-ES":
      return "Spanish";
    case "fr-FR":
      return "French";
    case "de-DE":
      return "German";
    case "ja-JP":
      return "Japanese";
    default:
      return code;
  }
}

interface CardActionProps {
  icon: ComponentType<IconProps>;
  label: string;
  destructive?: boolean;
  onClick: () => void;
}

function CardAction({
  icon: Icon,
  label,
  destructive,
  onClick,
}: CardActionProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e: MouseEvent) => {
        e.stopPropagation(); // don't trigger card click (edit)
        onClick();
      }}
      style={{
        width: 26,
        height: 26,
        padding: 0,
        background: hovered ? "var(--bg-high)" : "transparent",
        border: "none",
        borderRadius: "var(--radius-micro)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        transition: "background-color 120ms ease",
      }}
    >
      <Icon
        size={14}
        weight="regular"
        color={
          hovered
            ? destructive
              ? "var(--accent-error)"
              : "var(--text-primary)"
            : "var(--text-secondary)"
        }
        style={{ transition: "color 120ms ease" }}
      />
    </button>
  );
}
