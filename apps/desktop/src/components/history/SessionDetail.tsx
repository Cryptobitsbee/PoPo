import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Play,
  Pause,
  Copy,
  Trash,
  PencilSimple,
  Check,
  X,
} from "@phosphor-icons/react";
import type { Session } from "@popo/shared-types";
import Textarea from "../shared/Textarea";
import { useHistoryStore } from "../../store/historyStore";
import { useAuthStore } from "../../store/authStore";
import { useSettingsStore } from "../../store/settingsStore";
import { saveSession } from "../../lib/firestore";
import { trackSync } from "../../store/syncLogStore";

/**
 * SessionDetail — expanded panel shown below a selected SessionRow.
 *
 * Session 30 restructure:
 *   - The row header already shows the full transcript and metadata
 *     (transcript on top, chips below) when expanded. This panel is
 *     ONLY the audio player + row-scoped action buttons. No text.
 *
 * Waveform player:
 *   - Decodes the audio file via Web Audio API's decodeAudioData,
 *     buckets the first channel into ~60 peak samples, renders them
 *     as bars in an SVG.
 *   - Bars before the playhead fill with --text-primary; bars after
 *     fade to --border-subtle. A thin vertical line marks the exact
 *     playhead position.
 *   - Click anywhere on the waveform to seek. No native <input
 *     type="range"> anywhere (that's where the stray browser-blue
 *     thumb was coming from).
 *
 * Audio source resolution:
 *   1. session.audioDownloadUrl (Firebase Storage, cross-device)
 *   2. Bytes read via Rust `cmd_read_audio_bytes` → Blob URL
 *      (local-only WAV at %APPDATA%\popo\audio\{id}.wav)
 *   3. Nothing — render a single-line helper instead of the player.
 */

export interface SessionDetailProps {
  session: Session;
  onCopy: () => void;
  onDelete: () => void;
  /** When true, start playback as soon as audio source is ready. */
  autoPlay?: boolean;
  /** Called after auto-play was initiated so parent can reset the flag. */
  onDidAutoPlay?: () => void;
}

const BAR_COUNT = 64;

export default function SessionDetail({
  session,
  onCopy,
  onDelete,
  autoPlay,
  onDidAutoPlay,
}: SessionDetailProps) {
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Inline-edit state. `editing` toggles a Textarea at the top of the
  // panel (replacing the audio player for focus) and swaps the action
  // buttons to Done/Cancel. Chirp output isn't always perfect —
  // letting the user correct in-place is a valuable escape hatch.
  const [editing, setEditing] = useState(false);
  const [draftTranscript, setDraftTranscript] = useState("");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const audioBytesRef = useRef<ArrayBuffer | null>(null);

  // ── Resolve audio source ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      // Priority 1: cloud download URL.
      if (session.audioDownloadUrl) {
        setAudioSrc(session.audioDownloadUrl);
        return;
      }

      // Priority 2: local path.
      // Session 56: ALWAYS load bytes via Rust command instead of the
      // convertFileSrc shortcut. The old shortcut set an asset://
      // URL that the <audio> element could play but that fetch()
      // couldn't read (WebView2 doesn't support fetching the asset
      // protocol). Without raw bytes, decodeAudioData in the peaks
      // effect would fail and the waveform stayed as a static
      // placeholder pattern. Loading bytes guarantees BOTH playback
      // (via Blob URL) AND waveform decoding (via audioBytesRef).
      if (session.audioStoragePath) {
        setLoadingAudio(true);
        try {
          const bytes = await invoke<number[]>("cmd_read_audio_bytes", {
            path: session.audioStoragePath,
          });
          if (cancelled) return;
          if (!bytes || bytes.length === 0) {
            setAudioError("Audio file is empty.");
            return;
          }
          const u8 = new Uint8Array(bytes);
          // Copy buffer for the Web Audio decoder (can't share with Blob).
          audioBytesRef.current = u8.slice().buffer;
          const blob = new Blob([u8], { type: "audio/wav" });
          const url = URL.createObjectURL(blob);
          blobUrlRef.current = url;
          setAudioSrc(url);
        } catch (e) {
          if (cancelled) return;
          const msg = e instanceof Error ? e.message : String(e);
          setAudioError(`Couldn't read recording. ${msg}`);
        } finally {
          if (!cancelled) setLoadingAudio(false);
        }
        return;
      }

      // Priority 3: no audio stored for this session.
      setAudioSrc(null);
    }

    void resolve();

    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [session.audioDownloadUrl, session.audioStoragePath]);

  // ── Compute peaks for the waveform (Rust-side) ─────────────
  // Session 56: moved peak computation to Rust (`cmd_get_audio_peaks`)
  // instead of doing it in the browser via Web Audio API's
  // `decodeAudioData`. The old browser-based approach silently failed
  // in WebView2 (fetch of asset:// URLs isn't supported, and the
  // ArrayBuffer copy chain was fragile), leaving peaks as null and
  // the waveform as a static placeholder.
  //
  // The Rust command reads the WAV file natively with `hound`,
  // computes peak-per-bucket, normalizes to 0..1, and returns a tiny
  // JSON array of 64 floats. Zero Web Audio, zero decoding fragility.
  useEffect(() => {
    // Only local files have a path we can pass to Rust.
    if (!session.audioStoragePath) {
      // For cloud-only sessions (no local WAV), we can't compute
      // peaks server-side. Leave as null (placeholder renders).
      // A future enhancement could download the cloud file first.
      setPeaks(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const result = await invoke<number[]>("cmd_get_audio_peaks", {
          path: session.audioStoragePath,
          barCount: BAR_COUNT,
        });
        if (cancelled) return;
        if (result && result.length > 0) {
          setPeaks(result);
        }
      } catch (e) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn("[popo] cmd_get_audio_peaks failed:", e);
        setPeaks(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session.audioStoragePath]);

  // Auto-play: when the Play button was clicked from the collapsed
  // row, the parent passes autoPlay=true. We wait until audioSrc is
  // resolved, then trigger playback once.
  useEffect(() => {
    if (!autoPlay || !audioSrc) return;
    // Small delay so the <audio> element has time to mount + set src.
    const t = setTimeout(() => {
      const el = audioRef.current;
      if (el) {
        el.play().catch(() => {});
      }
      onDidAutoPlay?.();
    }, 150);
    return () => clearTimeout(t);
  }, [autoPlay, audioSrc, onDidAutoPlay]);

  // Stop playback on unmount.
  useEffect(() => {
    return () => {
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.currentTime = 0;
      }
    };
  }, []);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
    } else {
      el.play().catch(() => setPlaying(false));
    }
  };

  const handleSeek = (ratio: number) => {
    const el = audioRef.current;
    if (!el || !isFinite(el.duration)) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    const next = clamped * el.duration;
    el.currentTime = next;
    setCurrentTime(next);
  };

  const hasAudio = audioSrc !== null;

  // ── Inline edit helpers ──────────────────────────────────────────
  const beginEdit = () => {
    setDraftTranscript(session.formattedTranscript ?? session.rawTranscript);
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraftTranscript("");
    setEditing(false);
  };

  const handleSaveEdit = () => {
    const newText = draftTranscript.trim();
    if (!newText) return; // don't allow empty transcripts
    const updated: Session = {
      ...session,
      rawTranscript: newText,
      // Replace both so the displayed text always matches what's
      // stored. Mirrors how Rust writes — formattedTranscript is
      // the post-prompt output; both fields end up the same for
      // non-prompt sessions.
      formattedTranscript: newText,
    };
    useHistoryStore.getState().updateSession(session.id, {
      rawTranscript: newText,
      formattedTranscript: newText,
    });

    // Firestore write — fire-and-forget via trackSync.
    const uid = useAuthStore.getState().user?.uid;
    const privacyMode = useSettingsStore.getState().settings.privacyMode;
    if (uid && !privacyMode) {
      trackSync("write", `users/${uid}/sessions/${session.id}`, () =>
        saveSession(uid, updated),
      ).catch(() => {
        /* already surfaced through trackSync */
      });
    }
    setEditing(false);
  };

  // While editing, Copy grabs the draft — what the user sees is what
  // ends up on the clipboard. Otherwise delegate to parent.
  const handleCopy = () => {
    if (editing) {
      const text = draftTranscript.trim();
      if (!text) return;
      void navigator.clipboard.writeText(text).catch(() => {
        /* clipboard API unavailable — noop, worst case user retypes */
      });
      return;
    }
    onCopy();
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      // Content fade-in runs in parallel with the parent grid's
      // height animation so the text + player don't pop in after
      // the row finishes expanding. Pure CSS keyframes — no Framer
      // here, which means no layout remeasure.
      style={{
        animation: "popo-detail-fade 240ms cubic-bezier(0.22, 1, 0.36, 1) both",
      }}
    >
      <style>{`
        @keyframes popo-detail-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
      <div
        style={{
          padding:
            "var(--sp-4) var(--sp-2) var(--sp-6) calc(var(--sp-2) + 2px)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-5)",
        }}
      >
        {/* Inline-edit surface — replaces the audio player while active */}
        {editing && (
          <Textarea
            rows={6}
            value={draftTranscript}
            onChange={(e) => setDraftTranscript(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancelEdit();
              }
            }}
            autoFocus
            placeholder="Transcript…"
          />
        )}

        {/* Audio block — only renders when there's something to play
            AND the user isn't editing. Hidden during edit so the
            textarea keeps focus (and the panel stays visually calm). */}
        {!editing && (hasAudio || loadingAudio || audioError) && (
          <WaveformPlayer
            src={audioSrc}
            loading={loadingAudio}
            error={audioError}
            peaks={peaks}
            playing={playing}
            currentTime={currentTime}
            duration={duration}
            audioRef={audioRef}
            onToggle={togglePlay}
            onSeek={handleSeek}
            onTimeUpdate={() => {
              const el = audioRef.current;
              if (el) setCurrentTime(el.currentTime);
            }}
            onLoadedMetadata={() => {
              const el = audioRef.current;
              if (el && isFinite(el.duration)) setDuration(el.duration);
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setPlaying(false);
              setCurrentTime(0);
            }}
          />
        )}

        {/* Action row */}
        <div style={{ display: "flex", gap: "var(--sp-2)" }}>
          <DetailButton
            icon={<Copy size={13} weight="regular" />}
            label="Copy"
            onClick={handleCopy}
          />
          <DetailButton
            icon={
              editing ? (
                <Check size={13} weight="regular" />
              ) : (
                <PencilSimple size={13} weight="regular" />
              )
            }
            label={editing ? "Done" : "Edit"}
            onClick={editing ? handleSaveEdit : beginEdit}
          />
          {editing ? (
            <DetailButton
              icon={<X size={13} weight="regular" />}
              label="Cancel"
              onClick={cancelEdit}
            />
          ) : (
            <DetailButton
              icon={<Trash size={13} weight="regular" />}
              label="Delete"
              onClick={onDelete}
              tone="destructive"
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Waveform player ──────────────────────────────────────────────────

interface WaveformPlayerProps {
  src: string | null;
  loading: boolean;
  error: string | null;
  peaks: number[] | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  onToggle: () => void;
  onSeek: (ratio: number) => void;
  onTimeUpdate: () => void;
  onLoadedMetadata: () => void;
  onPlay: () => void;
  onPause: () => void;
  onEnded: () => void;
}

function WaveformPlayer({
  src,
  loading,
  error,
  peaks,
  playing,
  currentTime,
  duration,
  audioRef,
  onToggle,
  onSeek,
  onTimeUpdate,
  onLoadedMetadata,
  onPlay,
  onPause,
  onEnded,
}: WaveformPlayerProps) {
  if (error) {
    return <PlayerLine>{error}</PlayerLine>;
  }
  if (loading) {
    return <PlayerLine>Loading recording…</PlayerLine>;
  }

  const progressRatio = duration > 0 ? currentTime / duration : 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        padding: "var(--sp-3) var(--sp-3)",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-faint)",
        borderRadius: "var(--radius-button)",
      }}
    >
      {/* Hidden <audio> — single source of truth for playback */}
      {src && (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onTimeUpdate={onTimeUpdate}
          onLoadedMetadata={onLoadedMetadata}
          onPlay={onPlay}
          onPause={onPause}
          onEnded={onEnded}
        />
      )}

      {/* Play / Pause button (themed, no native controls) */}
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        title={playing ? "Pause" : "Play"}
        onClick={onToggle}
        style={{
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-pill)",
          color: "var(--text-primary)",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {playing ? (
          <Pause size={13} weight="fill" />
        ) : (
          <Play
            size={13}
            weight="fill"
            style={{ transform: "translateX(1px)" }}
          />
        )}
      </button>

      {/* Waveform */}
      <Waveform peaks={peaks} progress={progressRatio} onSeek={onSeek} />

      {/* Time */}
      <div
        style={{
          fontFamily: "var(--font-pixel-grid)",
          fontSize: "var(--text-xs)",
          color: "var(--text-secondary)",
          fontVariantNumeric: "tabular-nums",
          minWidth: 82,
          textAlign: "right",
          flexShrink: 0,
        }}
      >
        {formatTime(currentTime)} / {formatTime(duration)}
      </div>
    </div>
  );
}

function PlayerLine({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "var(--sp-3) var(--sp-3)",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-faint)",
        borderRadius: "var(--radius-button)",
        fontFamily: "var(--font-pixel-line)",
        fontSize: "var(--text-xs)",
        color: "var(--text-secondary)",
      }}
    >
      {children}
    </div>
  );
}

// ── Waveform svg ────────────────────────────────────────────────────

interface WaveformProps {
  peaks: number[] | null;
  /** 0..1, current play position */
  progress: number;
  onSeek: (ratio: number) => void;
}

function Waveform({ peaks, progress, onSeek }: WaveformProps) {
  // Fixed bars count keeps layout stable while peaks are loading.
  // Placeholder bars have a flat baseline amplitude so the block
  // doesn't feel empty before decode resolves.
  const effective =
    peaks ??
    Array.from(
      { length: BAR_COUNT },
      (_, i) => 0.14 + 0.06 * Math.sin(i * 0.45),
    );

  // SVG coordinate system: 1000 wide × 40 tall.
  const W = 1000;
  const H = 40;
  // Session 56: bars made MUCH narrower (3px visual, was ~10px).
  // The old fat bars looked like uniform dots because when height≈width
  // (both ~10px) and rx=half-width, you get a circle. Thin bars
  // (width 3px, height 4–40px) look like sticks/pillars — the classic
  // waveform visual where height variation reads immediately.
  const slot = W / BAR_COUNT;
  const barW = Math.min(slot * 0.35, 5); // cap at 5 SVG-units wide (~3px rendered)
  const minBarH = 3; // floor so silence still reads as a visible dot
  const playheadX = progress * W;

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onSeek(ratio);
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onClick={handleClick}
      style={{
        flex: 1,
        height: 40,
        width: "100%",
        cursor: "pointer",
        display: "block",
      }}
    >
      {effective.map((peak, i) => {
        // Apply a gentle power curve to exaggerate height differences.
        // Without this, peaks clustered in 0.3–0.6 all look similar.
        // pow(peak, 0.7) spreads the mid-range out while keeping
        // quiet parts visible.
        const curved = Math.pow(peak, 0.7);
        const h = Math.max(minBarH, curved * H);
        const x = i * slot + (slot - barW) / 2;
        const y = (H - h) / 2;
        const played = (i + 0.5) * slot <= playheadX;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={h}
            rx={barW / 2}
            ry={barW / 2}
            fill={played ? "var(--text-primary)" : "var(--text-ghost)"}
            style={{ transition: "fill 80ms linear" }}
          />
        );
      })}
      {/* Playhead line */}
      <line
        x1={playheadX}
        x2={playheadX}
        y1={2}
        y2={H - 2}
        stroke="var(--text-primary)"
        strokeWidth={1}
        opacity={progress > 0 ? 0.7 : 0}
      />
    </svg>
  );
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "00:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ── Action button ────────────────────────────────────────────────────

interface DetailButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: "default" | "destructive";
}

function DetailButton({
  icon,
  label,
  onClick,
  tone = "default",
}: DetailButtonProps) {
  const [hovered, setHovered] = useState(false);
  const destructive = tone === "destructive";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-1)",
        padding: "6px 10px",
        background: hovered ? "var(--bg-elevated)" : "transparent",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-button)",
        color: destructive
          ? hovered
            ? "var(--accent-error)"
            : "var(--text-secondary)"
          : hovered
            ? "var(--text-primary)"
            : "var(--text-secondary)",
        fontFamily: "var(--font-pixel-line)",
        fontSize: "var(--text-xs)",
        cursor: "pointer",
        transition: "color 120ms ease, background-color 120ms ease",
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
