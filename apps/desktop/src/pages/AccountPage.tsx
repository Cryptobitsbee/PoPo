import { useMemo, useState } from "react";
import {
  computeMetrics,
  formatCost,
  formatHoursCompact,
} from "../lib/stats-compute";
import {
  GoogleLogo,
  SignOut,
  User as UserIcon,
  Warning,
  Check,
  Clock,
  ChatText,
  Waveform,
  Coins,
} from "@phosphor-icons/react";
import Button from "../components/shared/Button";
import SettingsGroup from "../components/settings/SettingsGroup";
import SettingRow from "../components/settings/SettingRow";
import SyncLogViewer from "../components/account/SyncLogViewer";
import FirestoreTestButton from "../components/account/FirestoreTestButton";
import { useAuthStore } from "../store/authStore";
import { useHistoryStore } from "../store/historyStore";
import {
  isFirebaseConfigured,
  isTauriContext,
  signInWithGoogle,
  signOut,
} from "../lib/firebase";

/**
 * AccountPage — sign-in, profile, usage stats, sync status, actions.
 *
 * Visual language matches SettingsPage: max-width ~680px, groups with
 * uppercase labels, 56px rows with --border-faint separators.
 *
 * Four UI states driven by authStore.status:
 *   - "unconfigured" : Firebase env vars missing → setup instructions.
 *   - "loading"      : initial hydration → subtle placeholder.
 *   - "signed-out"   : hero + Google Sign-In CTA.
 *   - "signed-in"    : profile + usage stats + sync status + actions.
 */
export default function AccountPage() {
  const status = useAuthStore((s) => s.status);

  return (
    <div
      style={{
        padding: "var(--sp-8) var(--sp-10)",
        maxWidth: 680,
        margin: "0 auto",
      }}
    >
      <h1
        style={{
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-xl)",
          lineHeight: 1.1,
          fontWeight: 500,
          color: "var(--text-primary)",
          margin: 0,
          marginBottom: "var(--sp-6)",
        }}
      >
        Account
      </h1>

      {status === "unconfigured" ? (
        <UnconfiguredPanel />
      ) : status === "loading" ? (
        <LoadingPanel />
      ) : status === "signed-out" ? (
        <SignedOutPanel />
      ) : (
        <SignedInPanel />
      )}
    </div>
  );
}

// ─── Unconfigured ───────────────────────────────────────────────────

function UnconfiguredPanel() {
  return (
    <div
      style={{
        padding: "var(--sp-6)",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-card)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-2)",
          marginBottom: "var(--sp-3)",
        }}
      >
        <Warning size={16} weight="regular" color="var(--text-secondary)" />
        <span
          style={{
            fontFamily: "var(--font-pixel-square)",
            fontSize: "var(--text-sm)",
          }}
        >
          Firebase not configured
        </span>
      </div>
      <p
        style={{
          fontFamily: "var(--font-pixel-line)",
          fontSize: "var(--text-sm)",
          color: "var(--text-secondary)",
          margin: 0,
          marginBottom: "var(--sp-3)",
          lineHeight: 1.6,
        }}
      >
        Sign-in and cloud sync are disabled because the Firebase web SDK config
        is missing. Add your keys to{" "}
        <code
          style={{
            fontFamily: "var(--font-pixel-grid)",
            fontSize: "var(--text-xs)",
            padding: "2px 6px",
            background: "var(--bg-elevated)",
            borderRadius: "var(--radius-micro)",
          }}
        >
          apps/desktop/.env.local
        </code>{" "}
        and restart the dev server.
      </p>
    </div>
  );
}

// ─── Loading ────────────────────────────────────────────────────────

function LoadingPanel() {
  return (
    <div
      style={{
        padding: "var(--sp-6)",
        fontFamily: "var(--font-pixel-line)",
        fontSize: "var(--text-sm)",
        color: "var(--text-secondary)",
      }}
    >
      Checking sign-in status…
    </div>
  );
}

// ─── Signed out ─────────────────────────────────────────────────────

function SignedOutPanel() {
  const error = useAuthStore((s) => s.error);
  const setError = useAuthStore((s) => s.setError);
  const [busy, setBusy] = useState(false);

  const handleSignIn = async () => {
    if (!isFirebaseConfigured) return;
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
      // In Tauri the redirect path navigates away; in browser the popup
      // resolves and onAuthStateChanged handles the rest.
    } catch (e) {
      // Tauri invoke() rejects with plain strings, not Error objects.
      // Firebase and our own throws use Error. Handle all cases.
      // eslint-disable-next-line no-console
      console.error("[popo] sign-in error:", e);
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "string" && e.length > 0
            ? e
            : JSON.stringify(e) || "Sign-in failed — check the console.";
      setError(msg);
      setBusy(false);
    }
  };

  return (
    <div>
      {/* Hero */}
      <div
        style={{
          padding: "var(--sp-8)",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-card)",
          textAlign: "center",
          marginBottom: "var(--sp-6)",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            margin: "0 auto var(--sp-4)",
            borderRadius: "50%",
            background: "var(--bg-elevated)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <UserIcon size={24} weight="regular" color="var(--text-secondary)" />
        </div>
        <h2
          style={{
            fontFamily: "var(--font-pixel-square)",
            fontSize: "var(--text-lg)",
            fontWeight: 500,
            color: "var(--text-primary)",
            margin: 0,
            marginBottom: "var(--sp-2)",
          }}
        >
          Sign in to sync your data
        </h2>
        <p
          style={{
            fontFamily: "var(--font-pixel-line)",
            fontSize: "var(--text-sm)",
            color: "var(--text-secondary)",
            margin: 0,
            marginBottom: "var(--sp-6)",
            lineHeight: 1.6,
            maxWidth: 440,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          Your dictation history, custom modes, and settings follow you across
          machines. Audio never leaves this device unless you explicitly enable
          it in Settings.
        </p>
        <Button
          variant="primary"
          iconLeft={<GoogleLogo size={14} weight="regular" />}
          disabled={busy || !isFirebaseConfigured}
          onClick={handleSignIn}
        >
          {busy
            ? isTauriContext()
              ? "Redirecting to Google…"
              : "Opening Google…"
            : "Sign in with Google"}
        </Button>

        {error ? (
          <div
            style={{
              marginTop: "var(--sp-4)",
              padding: "var(--sp-3) var(--sp-4)",
              background: "var(--bg-base)",
              border: "1px solid var(--accent-error)",
              borderRadius: "var(--radius-button)",
              fontFamily: "var(--font-pixel-line)",
              fontSize: "var(--text-xs)",
              color: "var(--accent-error)",
              textAlign: "left",
            }}
          >
            {error}
          </div>
        ) : null}
      </div>

      {/* What syncs */}
      <SettingsGroup label="What syncs" first>
        <SyncInfoRow
          label="Sessions"
          detail="Every dictation saved to your account"
        />
        <SyncInfoRow
          label="Modes"
          detail="Your custom AI post-processing prompts"
        />
        <SyncInfoRow
          label="Settings"
          detail="Preferences and GCP config reference"
          last
        />
      </SettingsGroup>
    </div>
  );
}

// ─── Signed in ──────────────────────────────────────────────────────

function SignedInPanel() {
  const user = useAuthStore((s) => s.user);
  const error = useAuthStore((s) => s.error);
  const [busy, setBusy] = useState(false);

  const handleSignOut = async () => {
    setBusy(true);
    try {
      await signOut();
    } finally {
      setBusy(false);
    }
  };

  // Usage stats — computed from the current historyStore snapshot.
  const sessions = useHistoryStore((s) => s.sessions);
  const metrics = useMemo(() => computeMetrics(sessions), [sessions]);

  if (!user) return null;

  return (
    <div>
      {/* Profile card */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-5)",
          padding: "var(--sp-6) var(--sp-7)",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-card)",
        }}
      >
        <Avatar photoURL={user.photoURL} displayName={user.displayName} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-pixel-square)",
              fontSize: "var(--text-base)",
              fontWeight: 500,
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {user.displayName ?? "Unnamed account"}
          </div>
          <div
            style={{
              marginTop: 2,
              fontFamily: "var(--font-pixel-line)",
              fontSize: "var(--text-xs)",
              color: "var(--text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {user.email ?? "no email"}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            flexShrink: 0,
            fontFamily: "var(--font-pixel-line)",
            fontSize: "var(--text-xs)",
            color: "var(--accent-success)",
          }}
        >
          <Check size={12} weight="regular" />
          Connected
        </div>
      </div>

      {/* Usage stats grid */}
      <SettingsGroup label="Your usage">
        <StatGrid
          items={[
            {
              icon: <Waveform size={14} weight="regular" />,
              label: "Sessions",
              value: metrics.totalSessions.toLocaleString(),
            },
            {
              icon: <ChatText size={14} weight="regular" />,
              label: "Words",
              value: metrics.totalWords.toLocaleString(),
            },
            {
              icon: <Clock size={14} weight="regular" />,
              label: "Dictated",
              value: formatHoursCompact(metrics.totalMs),
            },
            {
              icon: <Coins size={14} weight="regular" />,
              label: "Est. cost",
              value: formatCost(metrics.gcpCostUsd),
            },
          ]}
        />
      </SettingsGroup>

      {/* Sync log — live view of Firestore operations */}
      <SettingsGroup label="Sync log" headerAction={<FirestoreTestButton />}>
        <div style={{ padding: "var(--sp-4) 0" }}>
          <SyncLogViewer />
        </div>
      </SettingsGroup>

      {/* Account details */}
      <SettingsGroup label="Account details">
        <SettingRow label="Google ID">
          <Mono value={user.uid} />
        </SettingRow>
        <SettingRow label="Email">
          <Mono value={user.email ?? "—"} />
        </SettingRow>
        <SettingRow
          label="Signed in since"
          description="This sign-in session; token refreshes silently."
          last
        >
          <span
            style={{
              fontFamily: "var(--font-pixel-line)",
              fontSize: "var(--text-xs)",
              color: "var(--text-secondary)",
            }}
          >
            {user.metadata.lastSignInTime
              ? new Date(user.metadata.lastSignInTime).toLocaleString()
              : "—"}
          </span>
        </SettingRow>
      </SettingsGroup>

      {/* Actions */}
      <div
        style={{
          marginTop: "var(--sp-10)",
          paddingTop: "var(--sp-6)",
          borderTop: "1px solid var(--border-faint)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-pixel-line)",
            fontSize: "var(--text-xs)",
            color: "var(--text-secondary)",
          }}
        >
          Signing out keeps your data in Firestore; sign back in to restore it.
        </div>
        <Button
          variant="ghost"
          iconLeft={<SignOut size={14} weight="regular" />}
          disabled={busy}
          onClick={handleSignOut}
        >
          {busy ? "Signing out…" : "Sign out"}
        </Button>
      </div>

      {error ? (
        <div
          style={{
            marginTop: "var(--sp-4)",
            fontFamily: "var(--font-pixel-line)",
            fontSize: "var(--text-xs)",
            color: "var(--accent-error)",
          }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function Avatar({
  photoURL,
  displayName,
}: {
  photoURL: string | null;
  displayName: string | null;
}) {
  if (photoURL) {
    return (
      <img
        src={photoURL}
        alt={displayName ?? "profile"}
        referrerPolicy="no-referrer"
        style={{
          width: 52,
          height: 52,
          borderRadius: "50%",
          flexShrink: 0,
          objectFit: "cover",
          border: "2px solid var(--border-subtle)",
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: 52,
        height: 52,
        borderRadius: "50%",
        background: "var(--bg-elevated)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        border: "1px solid var(--border-subtle)",
      }}
    >
      <UserIcon size={24} weight="regular" color="var(--text-secondary)" />
    </div>
  );
}

function Mono({ value }: { value: string }) {
  return (
    <code
      style={{
        fontFamily: "var(--font-pixel-grid)",
        fontSize: "var(--text-xs)",
        color: "var(--text-secondary)",
        padding: "2px 8px",
        background: "var(--bg-elevated)",
        borderRadius: "var(--radius-micro)",
        maxWidth: 260,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        direction: "rtl",
        textAlign: "left",
      }}
      title={value}
    >
      {value}
    </code>
  );
}

function SyncInfoRow({
  label,
  detail,
  last,
}: {
  label: string;
  detail: string;
  last?: boolean;
}) {
  return (
    <SettingRow label={label} description={detail} last={last}>
      <span />
    </SettingRow>
  );
}

interface StatItem {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function StatGrid({ items }: { items: StatItem[] }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: "var(--sp-3)",
      }}
    >
      {items.map((it, i) => (
        <div
          key={i}
          style={{
            padding: "var(--sp-4)",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-card)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontFamily: "var(--font-pixel-grid)",
              fontSize: "var(--text-xs)",
              color: "var(--text-ghost)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: "var(--sp-2)",
            }}
          >
            <span style={{ color: "var(--text-secondary)" }}>{it.icon}</span>
            {it.label}
          </div>
          <div
            style={{
              fontFamily: "var(--font-pixel-square)",
              fontSize: "var(--text-lg)",
              fontVariantNumeric: "tabular-nums",
              color: "var(--text-primary)",
              lineHeight: 1.1,
            }}
          >
            {it.value}
          </div>
        </div>
      ))}
    </div>
  );
}
