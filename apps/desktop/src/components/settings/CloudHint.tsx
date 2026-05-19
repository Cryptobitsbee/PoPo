import { CloudSlash, CloudCheck } from "@phosphor-icons/react";
import { useAuthStore } from "../../store/authStore";

/**
 * CloudHint — auth-aware inline annotation for cloud-touching setting rows.
 *
 * Drop inside a SettingRow's `description` ReactNode to append a small
 * second line that explains the auth-state dependency of the setting:
 *
 *   <SettingRow
 *     description={
 *       <>
 *         Save the raw recording…
 *         <CloudHint
 *           when="signed-in"
 *           inlineNote="Audio also backs up to your Google account."
 *           signedOutNote="Saved only on this machine. Sign in to back up."
 *         />
 *       </>
 *     }
 *   >
 *
 * The hint only renders once auth status has resolved away from
 * "loading" — no flicker on app start, no hint when Firebase isn't
 * configured at all (because then the whole cloud story is off).
 *
 * Visual treatment is deliberately quieter than the parent description:
 * 1px-smaller type, --text-ghost color, and a small icon so the
 * eye reads it as a contextual annotation, not a second paragraph.
 */

export interface CloudHintProps {
  /**
   * Which auth state controls the primary "positive" message. Almost
   * always `"signed-in"` (the feature becomes more useful once signed
   * in). If omitted, defaults to `"signed-in"`.
   */
  when?: "signed-in" | "signed-out";
  /** Message shown when the user IS in the `when` state. Can be empty. */
  inlineNote: string;
  /** Message shown when the user is NOT in the `when` state. */
  signedOutNote: string;
}

export default function CloudHint({
  when = "signed-in",
  inlineNote,
  signedOutNote,
}: CloudHintProps) {
  const status = useAuthStore((s) => s.status);

  // Don't render anything during the initial auth hydration or when
  // Firebase isn't configured — both would produce a misleading
  // "sign in to sync" nudge that the user can't act on.
  if (status === "loading" || status === "unconfigured") return null;

  const matches =
    (when === "signed-in" && status === "signed-in") ||
    (when === "signed-out" && status === "signed-out");

  const note = matches ? inlineNote : signedOutNote;
  if (!note) return null;

  const positive = matches;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        marginTop: 4,
        color: positive ? "var(--text-secondary)" : "var(--text-ghost)",
        fontFamily: "var(--font-pixel-line)",
        fontSize: 10,
        lineHeight: 1.45,
        letterSpacing: 0.2,
        // New line so the hint sits under the main description rather
        // than running on.
        width: "100%",
      }}
    >
      {positive ? (
        <CloudCheck size={11} weight="regular" style={{ flexShrink: 0 }} />
      ) : (
        <CloudSlash size={11} weight="regular" style={{ flexShrink: 0 }} />
      )}
      <span>{note}</span>
    </span>
  );
}
