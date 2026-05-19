import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Microphone, Check } from "@phosphor-icons/react";
import WaveformCanvas from "../pill/WaveformCanvas";
import DotMatrix from "../pill/DotMatrix";

/**
 * HotkeyDemo — the interactive loop that demonstrates what popo
 * feels like. A 4-beat animation:
 *
 *   idle       → Ctrl Shift Space key chips, pill sleeping
 *   recording  → chips press down, pill expands, waveform pumps
 *   processing → DotMatrix loader replaces the waveform
 *   success    → checkmark, mock text types into a target input
 *
 * Loops continuously with a rest beat at the end. Pure local state,
 * no touches to popo's Rust pipeline or Zustand stores.
 *
 * Respects `prefers-reduced-motion`: the underlying Framer Motion
 * components already honor it, and the waveform timeline naturally
 * reads as a gentle pulse rather than high-frequency motion.
 */

type Stage = "idle" | "recording" | "processing" | "success";

const SAMPLE_TEXT = "hey team, just finished the draft.";

const STAGE_MS: Record<Stage, number> = {
  idle: 700,
  recording: 2000,
  processing: 850,
  success: 1600,
};

function computeBars(t: number): number[] {
  return Array.from({ length: 16 }, (_, i) => {
    const p = t * 4 + i * 0.4;
    return Math.max(
      0,
      Math.min(1, 0.45 + 0.4 * Math.sin(p) + 0.15 * Math.sin(p * 2.7)),
    );
  });
}

export default function HotkeyDemo() {
  const [stage, setStage] = useState<Stage>("idle");
  const [bars, setBars] = useState<number[]>(() => new Array(16).fill(0));
  const [typed, setTyped] = useState("");
  const startRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const typeRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const sequence: Stage[] = ["idle", "recording", "processing", "success"];
    let i = 0;
    const cleanups: Array<() => void> = [];

    const next = () => {
      if (cancelled) return;
      const s = sequence[i % sequence.length];
      setStage(s);

      if (s === "recording") {
        startRef.current = performance.now();
        const tick = () => {
          if (cancelled) return;
          const t = (performance.now() - startRef.current) / 1000;
          setBars(computeBars(t));
          rafRef.current = window.requestAnimationFrame(tick);
        };
        rafRef.current = window.requestAnimationFrame(tick);
      } else {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        setBars(new Array(16).fill(0));
      }

      if (s === "success") {
        setTyped("");
        let idx = 0;
        typeRef.current = window.setInterval(() => {
          if (cancelled) return;
          idx++;
          setTyped(SAMPLE_TEXT.slice(0, idx));
          if (idx >= SAMPLE_TEXT.length) {
            if (typeRef.current !== null) {
              window.clearInterval(typeRef.current);
              typeRef.current = null;
            }
          }
        }, 32);
      } else if (s === "idle") {
        setTyped("");
      }

      const timeout = window.setTimeout(() => {
        i++;
        next();
      }, STAGE_MS[s]);
      cleanups.push(() => window.clearTimeout(timeout));
    };

    next();

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (typeRef.current !== null) window.clearInterval(typeRef.current);
    };
  }, []);

  const pressed = stage === "recording" || stage === "processing";

  const pillWidth =
    stage === "idle"
      ? 80
      : stage === "recording"
        ? 176
        : stage === "processing"
          ? 144
          : 96;
  const pillHeight = stage === "idle" ? 14 : 40;

  return (
    <div
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 26,
      }}
    >
      {/* Key chips */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <KeyChip label="Ctrl" pressed={pressed} delay={0} />
        <Plus />
        <KeyChip label="Shift" pressed={pressed} delay={60} />
        <Plus />
        <KeyChip label="Space" pressed={pressed} delay={120} wide />
      </div>

      {/* The pill */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 48,
        }}
      >
        <motion.div
          animate={{ width: pillWidth, height: pillHeight }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
          style={{
            borderRadius: 9999,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background:
              stage === "idle" ? "var(--pill-sleep-bg)" : "var(--pill-bg)",
            border: `1px solid ${
              stage === "idle"
                ? "var(--pill-sleep-border)"
                : "var(--border-subtle)"
            }`,
            backdropFilter: "blur(var(--pill-blur))",
          }}
        >
          <AnimatePresence mode="wait">
            {stage === "recording" && (
              <motion.div
                key="rec"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "100%",
                  height: "100%",
                }}
              >
                <WaveformCanvas bars={bars} tone="active" barMaxHeight={20} />
              </motion.div>
            )}
            {stage === "processing" && (
              <motion.div
                key="proc"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  paddingInline: 14,
                }}
              >
                <DotMatrix size={14} tone="primary" />
                <span
                  style={{
                    fontFamily: "var(--font-pixel-line)",
                    fontSize: 11,
                    color: "var(--text-secondary)",
                    whiteSpace: "nowrap",
                    letterSpacing: 1,
                  }}
                >
                  transcribing
                </span>
              </motion.div>
            )}
            {stage === "success" && (
              <motion.div
                key="ok"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                <Check size={18} weight="bold" color="var(--text-primary)" />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* Mock target text field */}
      <div
        style={{
          width: "100%",
          maxWidth: 360,
          height: 42,
          borderRadius: "var(--radius-card)",
          border: "1px solid var(--border-subtle)",
          background: "var(--bg-surface)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 14px",
        }}
      >
        <Microphone
          size={13}
          weight="regular"
          color={
            stage === "idle" ? "var(--text-ghost)" : "var(--text-secondary)"
          }
        />
        <span
          style={{
            fontFamily: "var(--font-pixel-line)",
            fontSize: 13,
            color:
              typed.length > 0 ? "var(--text-primary)" : "var(--text-ghost)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {typed.length > 0 ? typed : "your cursor is here…"}
        </span>
        {typed.length > 0 && typed.length < SAMPLE_TEXT.length && (
          <span
            style={{
              display: "inline-block",
              width: 2,
              height: 14,
              background: "var(--text-primary)",
              animation: "popo-blink 1s steps(2) infinite",
            }}
          />
        )}
      </div>

      <style>{`
        @keyframes popo-blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ── Key chip ─────────────────────────────────────────────────────────

function KeyChip({
  label,
  pressed,
  delay,
  wide,
}: {
  label: string;
  pressed: boolean;
  delay: number;
  wide?: boolean;
}) {
  return (
    <motion.div
      animate={{
        y: pressed ? 2 : 0,
        scale: pressed ? 0.97 : 1,
      }}
      transition={{
        duration: 0.18,
        delay: pressed ? delay / 1000 : 0,
        ease: [0.16, 1, 0.3, 1],
      }}
      style={{
        minWidth: wide ? 74 : 50,
        height: 34,
        padding: "0 12px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "var(--radius-button)",
        background: pressed ? "var(--bg-surface)" : "var(--bg-elevated)",
        border: `1px solid ${
          pressed ? "var(--border-default)" : "var(--border-subtle)"
        }`,
        // DESIGN_SYSTEM §10 bans decorative box-shadow. We rely on the
        // background-surface step (elevated → surface on press) + the
        // border-color step (subtle → default on press) to communicate
        // depressed-key feel. No drop shadows needed.
        fontFamily: "var(--font-pixel-square)",
        fontSize: 12,
        color: pressed ? "var(--text-primary)" : "var(--text-secondary)",
        letterSpacing: 1,
        userSelect: "none",
      }}
    >
      {label}
    </motion.div>
  );
}

function Plus() {
  return (
    <span
      aria-hidden
      style={{
        fontFamily: "var(--font-pixel-line)",
        fontSize: 13,
        color: "var(--text-ghost)",
      }}
    >
      +
    </span>
  );
}
