import {
  CheckCircle,
  XCircle,
  CircleNotch,
  CloudArrowUp,
  CloudArrowDown,
  Trash,
  Broadcast,
} from "@phosphor-icons/react";
import {
  useSyncLogStore,
  type SyncLogEntry,
  type SyncKind,
} from "../../store/syncLogStore";
import Button from "../shared/Button";

/**
 * SyncLogViewer — a real-time view of every Firestore op popo has
 * attempted in this session. Read from `syncLogStore`.
 *
 * Shows: kind icon, path, status, duration, and error message on
 * failure. Lives in the AccountPage so the user can self-diagnose
 * cloud-sync problems.
 *
 * When signed-out, this typically shows nothing (no writes fire).
 * When signed-in, expect to see entries fill in as mutations happen.
 *
 * If an entry has status="error", the error text reveals the exact
 * cause (permission-denied, not-found, unavailable, unauthenticated,
 * etc.). This turns silent Firestore failures into visible failures.
 */
export default function SyncLogViewer() {
  const entries = useSyncLogStore((s) => s.entries);
  const clear = useSyncLogStore((s) => s.clear);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--sp-3)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-pixel-line)",
            fontSize: "var(--text-xs)",
            color: "var(--text-secondary)",
            lineHeight: 1.5,
          }}
        >
          {entries.length === 0
            ? "No Firestore operations yet. Mutations will appear here."
            : `${entries.length} recent operation${entries.length === 1 ? "" : "s"}`}
        </div>
        {entries.length > 0 ? (
          <Button variant="ghost" onClick={clear}>
            Clear log
          </Button>
        ) : null}
      </div>

      <div
        style={{
          maxHeight: 320,
          overflowY: "auto",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-card)",
        }}
      >
        {entries.length === 0 ? (
          <div
            style={{
              padding: "var(--sp-6)",
              textAlign: "center",
              fontFamily: "var(--font-pixel-line)",
              fontSize: "var(--text-xs)",
              color: "var(--text-secondary)",
              opacity: 0.6,
            }}
          >
            Waiting for activity…
          </div>
        ) : (
          entries.map((entry, i) => (
            <SyncLogRow
              key={entry.id}
              entry={entry}
              isLast={i === entries.length - 1}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SyncLogRow({
  entry,
  isLast,
}: {
  entry: SyncLogEntry;
  isLast: boolean;
}) {
  const StatusIcon =
    entry.status === "ok"
      ? CheckCircle
      : entry.status === "error"
        ? XCircle
        : CircleNotch;

  const statusColor =
    entry.status === "ok"
      ? "var(--accent-success)"
      : entry.status === "error"
        ? "var(--accent-error)"
        : "var(--text-secondary)";

  const KindIcon = iconForKind(entry.kind);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--sp-3)",
        padding: "var(--sp-3) var(--sp-4)",
        borderBottom: isLast ? "none" : "1px solid var(--border-faint)",
      }}
    >
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 20,
          height: 20,
          color: "var(--text-secondary)",
        }}
        title={entry.kind}
      >
        <KindIcon size={14} weight="regular" />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-pixel-mono, monospace)",
            fontSize: "var(--text-xs)",
            color: "var(--text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {entry.path}
        </div>
        {entry.error ? (
          <div
            style={{
              marginTop: 2,
              fontFamily: "var(--font-pixel-line)",
              fontSize: "var(--text-xs)",
              color: "var(--accent-error)",
              lineHeight: 1.4,
              wordBreak: "break-word",
              whiteSpace: "normal",
            }}
          >
            {entry.error}
          </div>
        ) : null}
      </div>

      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontFamily: "var(--font-pixel-line)",
          fontSize: "var(--text-xs)",
          color: statusColor,
        }}
      >
        {entry.durationMs !== undefined ? (
          <span
            style={{
              fontFamily: "var(--font-pixel-mono, monospace)",
              color: "var(--text-secondary)",
            }}
          >
            {entry.durationMs}ms
          </span>
        ) : null}
        <StatusIcon
          size={14}
          weight="regular"
          style={
            entry.status === "pending"
              ? { animation: "popo-spin 800ms linear infinite" }
              : undefined
          }
        />
      </div>
    </div>
  );
}

function iconForKind(kind: SyncKind) {
  switch (kind) {
    case "write":
      return CloudArrowUp;
    case "delete":
      return Trash;
    case "load":
      return CloudArrowDown;
    case "subscribe":
      return Broadcast;
  }
}
