import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  ArrowLeft,
  GoogleLogo,
  CaretUp,
} from "@phosphor-icons/react";
import Button from "../shared/Button";
import PopoIcon from "../shared/PopoIcon";
import { useAuthStore } from "../../store/authStore";
import { signInWithGoogle, isFirebaseConfigured } from "../../lib/firebase";
import HotkeyDemo from "./HotkeyDemo";

/**
 * FirstRunOverlay — the first-launch welcome experience.
 *
 * Four calm steps (Session 30 redesign aligned with impeccable +
 * minimalist-skill):
 *
 *   1. welcome — the mark + name + one-line description. No tagline,
 *      no benefit-row SaaS clichés.
 *   2. demo    — the animated hotkey demonstration (key chips + pill
 *      + mock text field), showing the idle → recording → processing
 *      → success loop.
 *   3. tray    — "popo runs quietly in the background" with a small
 *      illustration of the Windows tray up-arrow + icon, so users
 *      know where to find it when the main window is closed.
 *   4. signin  — optional Google sign-in for cross-device sync, with
 *      a clearly-visible Skip / Get started path.
 *
 * Navigation: Back / Continue buttons + a small phase indicator.
 * Dismiss any time via "Get started" on step 4, Escape, or clicking
 * outside the content column. Keyboard: ← Back, → Continue, Esc skip.
 *
 * Persistence:
 *   - Rust `%APPDATA%\ai.popo.desktop\.installed` marker (gates show_main).
 *   - React `localStorage["popo:first-run-complete"]` (gates this overlay).
 * Both must be cleared for the overlay to appear on the next launch.
 * The NSIS installer clears the Rust marker; in-app "reset welcome" is
 * a dev-only affordance (clear the localStorage key manually).
 */

const FIRST_RUN_KEY = "popo:first-run-complete";
const EASE = [0.22, 1, 0.36, 1] as const;

export function shouldShowFirstRun(): boolean {
  try {
    return localStorage.getItem(FIRST_RUN_KEY) !== "1";
  } catch {
    return true;
  }
}

function markFirstRunComplete(): void {
  try {
    localStorage.setItem(FIRST_RUN_KEY, "1");
  } catch {
    /* quota / private mode — ignore */
  }
}

type Step = "welcome" | "demo" | "tray" | "signin";
const STEP_ORDER: Step[] = ["welcome", "demo", "tray", "signin"];

export default function FirstRunOverlay({
  onDismiss,
}: {
  onDismiss: () => void;
}) {
  const [step, setStep] = useState<Step>("welcome");
  const status = useAuthStore((s) => s.status);

  // Auto-dismiss if the user's already signed in (happens when the
  // Google handshake completed on a previous run and this install is
  // on the same profile).
  useEffect(() => {
    if (status === "signed-in") {
      markFirstRunComplete();
      onDismiss();
    }
  }, [status, onDismiss]);

  const handleDismiss = () => {
    markFirstRunComplete();
    onDismiss();
  };

  const currentIndex = STEP_ORDER.indexOf(step);
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === STEP_ORDER.length - 1;

  const goNext = () => {
    if (isLast) {
      handleDismiss();
      return;
    }
    setStep(STEP_ORDER[currentIndex + 1]);
  };

  const goBack = () => {
    if (isFirst) return;
    setStep(STEP_ORDER[currentIndex - 1]);
  };

  // Keyboard shortcuts: ← → for nav, Esc to skip.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleDismiss();
      } else if (e.key === "ArrowRight") {
        goNext();
      } else if (e.key === "ArrowLeft") {
        goBack();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "var(--bg-base)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {/* Frameless-window drag strip */}
      <div
        data-tauri-drag-region
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 40,
          zIndex: 200,
        }}
        aria-hidden
      />

      {/* Skip — top-right corner. Hidden on the last step (whose
          primary "Get started" button already dismisses). Sits above
          the drag strip so it stays clickable. Data-tauri-drag-region
          is OFF on this button so it's a real click target. */}
      {!isLast && (
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Skip onboarding"
          style={{
            position: "absolute",
            top: 12,
            right: 16,
            zIndex: 210,
            background: "transparent",
            border: "none",
            padding: "6px 10px",
            color: "var(--text-ghost)",
            fontFamily: "var(--font-pixel-line)",
            fontSize: 12,
            letterSpacing: 0.4,
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color =
              "var(--text-secondary)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color =
              "var(--text-ghost)";
          }}
        >
          Skip
        </button>
      )}

      {/* Ambient radial bloom */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 60% 40% at 50% 30%, rgba(237, 235, 230, 0.035), transparent 70%)",
          pointerEvents: "none",
        }}
      />

      {/* Content column */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: 520,
          padding: "0 32px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          flex: 1,
          justifyContent: "center",
          minHeight: 0,
        }}
      >
        <AnimatePresence mode="wait">
          {step === "welcome" && <WelcomeStep key="welcome" />}
          {step === "demo" && <DemoStep key="demo" />}
          {step === "tray" && <TrayStep key="tray" />}
          {step === "signin" && (
            <SigninStep key="signin" onDismiss={handleDismiss} />
          )}
        </AnimatePresence>
      </div>

      {/* Footer: step dots + back / continue / skip */}
      <div
        style={{
          width: "100%",
          padding: "0 32px 32px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 20,
        }}
      >
        {/* Step dots */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          {STEP_ORDER.map((s) => (
            <motion.div
              key={s}
              animate={{
                width: s === step ? 18 : 5,
                opacity: s === step ? 1 : 0.25,
              }}
              transition={{ duration: 0.3, ease: EASE }}
              style={{
                height: 5,
                background: "var(--text-primary)",
                borderRadius: 3,
              }}
            />
          ))}
        </div>

        {/* Nav row: Back ↔ Continue. Skip lives in the top-right
            corner of the overlay (see above) so it stays out of the
            primary action's footprint. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            maxWidth: 320,
          }}
        >
          {/* Back — visible after step 1 */}
          {!isFirst ? (
            <Button
              variant="ghost"
              onClick={goBack}
              iconLeft={<ArrowLeft size={13} weight="regular" />}
            >
              Back
            </Button>
          ) : (
            <span style={{ width: 80 }} />
          )}

          {/* Continue / Get started */}
          {!isLast ? (
            <Button
              variant="primary"
              onClick={goNext}
              iconRight={<ArrowRight size={13} weight="regular" />}
            >
              Continue
            </Button>
          ) : (
            <span style={{ width: 80 }} />
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ── Step 1: Welcome ──────────────────────────────────────────────────

function WelcomeStep() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.35, ease: EASE }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
      }}
    >
      <div
        style={{
          filter: "drop-shadow(0 10px 28px rgba(0, 0, 0, 0.4))",
        }}
      >
        <PopoIcon size={56} />
      </div>
      <h1
        style={{
          margin: "24px 0 0",
          fontFamily: "var(--font-pixel-square)",
          fontSize: 40,
          fontWeight: 500,
          letterSpacing: 2,
          color: "var(--text-primary)",
          lineHeight: 1,
        }}
      >
        popo
      </h1>
      <p
        style={{
          margin: "14px 0 0",
          fontFamily: "var(--font-pixel-line)",
          fontSize: 14,
          color: "var(--text-secondary)",
          lineHeight: 1.5,
          maxWidth: 340,
        }}
      >
        A voice keyboard for Windows. Hold a hotkey, speak, and your words
        appear at the cursor.
      </p>
    </motion.div>
  );
}

// ── Step 2: Hotkey demo ──────────────────────────────────────────────

function DemoStep() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.35, ease: EASE }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        width: "100%",
      }}
    >
      <h2
        style={{
          margin: 0,
          fontFamily: "var(--font-pixel-square)",
          fontSize: 24,
          fontWeight: 500,
          color: "var(--text-primary)",
          lineHeight: 1.15,
        }}
      >
        Hold. Speak. Release.
      </h2>
      <p
        style={{
          margin: "12px 0 34px",
          fontFamily: "var(--font-pixel-line)",
          fontSize: 13,
          color: "var(--text-secondary)",
          lineHeight: 1.5,
          maxWidth: 380,
        }}
      >
        Works in any Windows app — email, chat, editors, browsers.
      </p>

      <HotkeyDemo />
    </motion.div>
  );
}

// ── Step 3: Tray / background runner ─────────────────────────────────

function TrayStep() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.35, ease: EASE }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        maxWidth: 460,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontFamily: "var(--font-pixel-square)",
          fontSize: 24,
          fontWeight: 500,
          color: "var(--text-primary)",
          lineHeight: 1.2,
        }}
      >
        popo runs quietly.
      </h2>
      <p
        style={{
          margin: "12px 0 36px",
          fontFamily: "var(--font-pixel-line)",
          fontSize: 13,
          color: "var(--text-secondary)",
          lineHeight: 1.55,
        }}
      >
        Closing this window doesn't close popo. The hotkey keeps working in the
        background. Find the icon in your taskbar's hidden-tray area to open
        this page again or quit.
      </p>

      <TrayIllustration />

      <p
        style={{
          margin: "24px 0 0",
          fontFamily: "var(--font-pixel-line)",
          fontSize: 12,
          color: "var(--text-ghost)",
          lineHeight: 1.55,
          maxWidth: 360,
          letterSpacing: 0.3,
        }}
      >
        Click the up-arrow near the clock, then left-click popo to open the main
        window. Right-click for Quit.
      </p>
    </motion.div>
  );
}

function TrayIllustration() {
  // A tiny faux-taskbar strip with the up-arrow button and a
  // highlighted popo icon that gently pulses so the eye lands on it.
  return (
    <div
      style={{
        width: "100%",
        maxWidth: 380,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 18,
      }}
    >
      {/* Floating callout popover that would "appear" from the up-arrow */}
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.4, ease: EASE }}
        style={{
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-card)",
        }}
      >
        {/* Mini popo icon, pulsing */}
        <motion.div
          animate={{
            scale: [1, 1.06, 1],
            opacity: [0.85, 1, 0.85],
          }}
          transition={{
            duration: 2.4,
            repeat: Infinity,
            ease: [0.4, 0, 0.4, 1],
          }}
          style={{
            padding: 4,
            background: "var(--bg-high)",
            border: "1px solid var(--border-default)",
            borderRadius: 6,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <PopoIcon size={18} />
        </motion.div>
        <div
          style={{
            fontFamily: "var(--font-pixel-line)",
            fontSize: 12,
            color: "var(--text-primary)",
            letterSpacing: 0.2,
          }}
        >
          popo
        </div>
      </motion.div>

      {/* Downward arrow connecting popover to the taskbar strip */}
      <div
        aria-hidden
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0,
          color: "var(--text-ghost)",
        }}
      >
        <div
          style={{
            width: 1,
            height: 12,
            background: "var(--border-default)",
          }}
        />
      </div>

      {/* Mock Windows taskbar strip */}
      <div
        style={{
          width: "100%",
          height: 44,
          padding: "0 12px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-card)",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 10,
        }}
      >
        {/* Placeholder app icons to the left */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingLeft: 2,
          }}
        >
          <TaskbarDot />
          <TaskbarDot />
          <TaskbarDot />
        </div>

        {/* The up-arrow — the thing the user needs to find */}
        <motion.div
          animate={{
            y: [0, -2, 0],
          }}
          transition={{
            duration: 1.8,
            repeat: Infinity,
            ease: [0.4, 0, 0.4, 1],
          }}
          style={{
            width: 26,
            height: 26,
            borderRadius: 4,
            background: "var(--bg-high)",
            border: "1px solid var(--border-default)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-primary)",
          }}
        >
          <CaretUp size={12} weight="bold" />
        </motion.div>

        {/* Clock placeholder */}
        <div
          style={{
            fontFamily: "var(--font-pixel-grid)",
            fontSize: 11,
            color: "var(--text-ghost)",
            letterSpacing: 0.4,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          12:45
        </div>
      </div>
    </div>
  );
}

function TaskbarDot() {
  return (
    <div
      aria-hidden
      style={{
        width: 22,
        height: 22,
        borderRadius: 4,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
      }}
    />
  );
}

// ── Step 4: Sign in / get started ────────────────────────────────────

function SigninStep({ onDismiss }: { onDismiss: () => void }) {
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      await signInWithGoogle();
      onDismiss();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Sign-in failed. Try again or skip.",
      );
      setSigningIn(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.35, ease: EASE }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        maxWidth: 440,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontFamily: "var(--font-pixel-square)",
          fontSize: 24,
          fontWeight: 500,
          color: "var(--text-primary)",
          lineHeight: 1.2,
        }}
      >
        Sign in, or start now.
      </h2>
      <p
        style={{
          margin: "12px 0 32px",
          fontFamily: "var(--font-pixel-line)",
          fontSize: 13,
          color: "var(--text-secondary)",
          lineHeight: 1.55,
        }}
      >
        Signing in syncs your history, modes, and settings across devices. You
        can always sign in later from Settings.
      </p>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          width: 280,
        }}
      >
        {isFirebaseConfigured && (
          <Button
            variant="primary"
            fullWidth
            disabled={signingIn}
            onClick={handleSignIn}
            iconLeft={<GoogleLogo size={13} weight="bold" />}
          >
            {signingIn ? "Opening browser…" : "Continue with Google"}
          </Button>
        )}

        <Button
          variant={isFirebaseConfigured ? "ghost" : "primary"}
          fullWidth
          onClick={onDismiss}
          iconRight={<ArrowRight size={13} weight="regular" />}
        >
          Get started
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 14,
            fontFamily: "var(--font-pixel-line)",
            fontSize: 12,
            color: "var(--accent-error)",
            lineHeight: 1.45,
            maxWidth: 340,
          }}
        >
          {error}
        </div>
      )}

      <p
        style={{
          margin: "28px 0 0",
          fontFamily: "var(--font-pixel-line)",
          fontSize: 11,
          color: "var(--text-ghost)",
          letterSpacing: 0.3,
          lineHeight: 1.55,
          maxWidth: 360,
        }}
      >
        You still need to add Google Cloud credentials in{" "}
        <span style={{ color: "var(--text-secondary)" }}>
          Settings → GCP Setup
        </span>{" "}
        before your first dictation.
      </p>
    </motion.div>
  );
}
