import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { MicDevice } from "@popo/shared-types";
import { useModesStore } from "../store/modesStore";
import { useSettingsStore } from "../store/settingsStore";
import Select from "../components/shared/Select";
import HoldToDictateButton, {
  type TestState,
} from "../components/test/HoldToDictateButton";
import TranscriptOutput from "../components/test/TranscriptOutput";

/**
 * TestPage — brief §3 Test.
 *
 *   Two-column layout, gap --sp-8, mt --sp-6
 *   LEFT: Microphone select · Mode select · Hold to Dictate button
 *   RIGHT: Transcript output box + word count + Copy
 *
 * Phase E (Session 21): wired to the real cpal + GCP Chirp pipeline.
 *
 *   mousedown/touchstart → cmd_test_dictate_start(micId)
 *     → Rust opens mic, starts emitting test:waveform events at 25 Hz
 *   mouseup/touchend   → cmd_test_dictate_stop()
 *     → Rust snapshots PCM, runs GCP transcription, emits test:transcript
 *
 * Fallback (outside Tauri / no GCP configured):
 *   cmd_test_dictate_stop returns normally and GCP falls back to
 *   `fake_transcribe` so the UI always gets a result.
 *
 * Outside Tauri (plain browser preview), invoke() throws and the
 * simulation mode (synthetic bars + sample transcript) acts as the
 * graceful fallback.
 */

// Fallback sample transcripts used when Tauri is not available.
const SAMPLE_TRANSCRIPTS: string[] = [
  "Hey team, quick update on the roadmap — we're still targeting December 15 for the beta release.",
  "Remind me to book the flight to Bangalore before Friday.",
  "const handleSubmit = async (event) => { event.preventDefault(); const result = await api.post('/sessions', data); }",
  "yaar, meeting thodi lambi ho gayi. I think we should ship on Monday.",
  "Thank you for joining the call. I wanted to circle back on the API rate limits.",
];

export default function TestPage() {
  const modes = useModesStore((s) => s.modes);
  const defaultModeId = useSettingsStore((s) => s.settings.defaultModeId);

  const modeOptions = modes.length
    ? modes.map((m) => ({ value: m.id, label: m.name }))
    : [{ value: "mode-auto", label: "Auto" }];

  // Mic device list — loaded from cmd_list_mics on mount.
  const [micDevices, setMicDevices] = useState<MicDevice[]>([
    { id: "", name: "System default microphone", isDefault: true },
  ]);
  const [selectedMic, setSelectedMic] = useState<string>("");
  const [selectedMode, setSelectedMode] = useState<string>(
    defaultModeId ?? modes[0]?.id ?? "mode-auto",
  );

  // State machine.
  const [state, setState] = useState<TestState>("idle");
  const [bars, setBars] = useState<number[]>(() => new Array(16).fill(0));
  const [transcript, setTranscript] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Refs to Tauri unsubscribe functions.
  const unlistenWaveform = useRef<(() => void) | null>(null);
  const unlistenTranscript = useRef<(() => void) | null>(null);

  // Simulation fallback (used when Tauri invoke fails).
  const barIntervalRef = useRef<number | undefined>(undefined);
  const processingTimeoutRef = useRef<number | undefined>(undefined);
  const simulationMode = useRef(false);

  // Load real mic list on mount.
  useEffect(() => {
    invoke<MicDevice[]>("cmd_list_mics")
      .then((list) => {
        if (Array.isArray(list) && list.length > 0) setMicDevices(list);
      })
      .catch(() => {
        /* Outside Tauri — keep fallback list. */
      });
  }, []);

  // Subscribe to real test:waveform + test:transcript events.
  useEffect(() => {
    listen<{ bars: number[] }>("test:waveform", (e) => {
      setBars(e.payload.bars);
    })
      .then((fn) => {
        unlistenWaveform.current = fn;
      })
      .catch(() => {});

    listen<{ text: string; error?: string }>("test:transcript", (e) => {
      const { text, error } = e.payload;
      if (error) {
        setErrorMsg(error);
        setState("idle");
      } else {
        setTranscript(text);
        setErrorMsg("");
        setState("done");
      }
    })
      .then((fn) => {
        unlistenTranscript.current = fn;
      })
      .catch(() => {});

    return () => {
      unlistenWaveform.current?.();
      unlistenTranscript.current?.();
    };
  }, []);

  // Cleanup on unmount.
  useEffect(
    () => () => {
      clearInterval(barIntervalRef.current);
      clearTimeout(processingTimeoutRef.current);
      // Stop any in-flight test session.
      invoke("cmd_test_dictate_stop").catch(() => {});
    },
    [],
  );

  const handleStart = async () => {
    if (state === "processing") return;
    setTranscript("");
    setErrorMsg("");
    setState("recording");
    simulationMode.current = false;

    try {
      await invoke("cmd_test_dictate_start", {
        micId: selectedMic || null,
      });
    } catch {
      // Tauri not available — fall back to simulation.
      simulationMode.current = true;
      _startSimulation();
    }
  };

  const handleStop = async () => {
    if (state !== "recording") return;
    setState("processing");

    if (simulationMode.current) {
      _stopSimulation();
      return;
    }

    try {
      await invoke("cmd_test_dictate_stop");
      // Result arrives via test:transcript event listener above.
    } catch {
      // Tauri invoke failed — show a graceful error.
      setErrorMsg("Dictation unavailable outside the Tauri app.");
      setState("idle");
    }
  };

  // ── Simulation fallback (plain browser preview only) ───────────────

  const _startSimulation = () => {
    const start = performance.now();
    barIntervalRef.current = window.setInterval(() => {
      const t = (performance.now() - start) / 1000;
      const next = new Array(16).fill(0).map((_, i) => {
        const phase = t * 4 + i * 0.4;
        return Math.max(
          0,
          Math.min(
            1,
            0.45 + 0.4 * Math.sin(phase) + 0.15 * Math.sin(phase * 2.7),
          ),
        );
      });
      setBars(next);
    }, 40);
  };

  const _stopSimulation = () => {
    clearInterval(barIntervalRef.current);
    setBars(new Array(16).fill(0));
    processingTimeoutRef.current = window.setTimeout(() => {
      const pick =
        SAMPLE_TRANSCRIPTS[
          Math.floor(Math.random() * SAMPLE_TRANSCRIPTS.length)
        ];
      setTranscript(pick);
      setState("done");
    }, 1200);
  };

  // ── Helpers ────────────────────────────────────────────────────────

  const handleClear = () => {
    setTranscript("");
    setErrorMsg("");
    setState("idle");
    invoke("cmd_test_dictate_stop").catch(() => {});
  };

  const handleCopy = async () => {
    if (!transcript) return;
    try {
      await navigator.clipboard.writeText(transcript);
    } catch {
      /* silent */
    }
  };

  const micOptions = micDevices.map((d) => ({
    value: d.id,
    label: d.name,
    description:
      d.isDefault && d.id !== "" ? "Current system default" : undefined,
  }));

  return (
    <div
      style={{
        padding: "var(--sp-8) var(--sp-10)",
        maxWidth: 1040,
        margin: "0 auto",
      }}
    >
      <h1
        style={{
          margin: 0,
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-xl)",
          lineHeight: 1.1,
          fontWeight: 500,
          color: "var(--text-primary)",
        }}
      >
        Test
      </h1>
      <p
        style={{
          marginTop: "var(--sp-3)",
          marginBottom: 0,
          maxWidth: 520,
          fontFamily: "var(--font-pixel-line)",
          fontSize: "var(--text-xs)",
          color: "var(--text-secondary)",
          lineHeight: 1.5,
        }}
      >
        Hold the button to record. Release to transcribe. The result appears on
        the right — it is not pasted anywhere.
        {errorMsg ? (
          <span style={{ color: "var(--accent-error)", marginLeft: 8 }}>
            {errorMsg}
          </span>
        ) : null}
      </p>

      <div
        style={{
          marginTop: "var(--sp-8)",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "var(--sp-8)",
          alignItems: "start",
        }}
      >
        {/* ── LEFT ──────────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--sp-4)",
          }}
        >
          <div>
            <label
              style={{
                display: "block",
                // Session 53: unified section-heading style.
                fontFamily: "var(--font-pixel-square)",
                fontSize: "var(--text-sm)",
                color: "var(--text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                fontWeight: 500,
                marginBottom: "var(--sp-2)",
              }}
            >
              Microphone
            </label>
            <Select
              value={selectedMic}
              options={micOptions}
              onChange={setSelectedMic}
              aria-label="Input device"
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                // Session 53: unified section-heading style.
                fontFamily: "var(--font-pixel-square)",
                fontSize: "var(--text-sm)",
                color: "var(--text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                fontWeight: 500,
                marginBottom: "var(--sp-2)",
              }}
            >
              Mode
            </label>
            <Select
              value={selectedMode}
              options={modeOptions}
              onChange={setSelectedMode}
              aria-label="Mode"
            />
          </div>

          <div style={{ marginTop: "var(--sp-4)" }}>
            <HoldToDictateButton
              state={state}
              bars={bars}
              onStart={handleStart}
              onStop={handleStop}
            />
          </div>
        </div>

        {/* ── RIGHT ─────────────────────────────────────────────── */}
        <TranscriptOutput
          state={state}
          transcript={transcript}
          onClear={handleClear}
          onCopy={handleCopy}
        />
      </div>
    </div>
  );
}
