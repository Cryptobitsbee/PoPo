import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  FolderOpen,
  Lightning,
  Check,
  Warning,
  Compass,
} from "@phosphor-icons/react";
import Button from "../shared/Button";
import { useSettingsStore } from "../../store/settingsStore";
import { relativeTime } from "../../lib/time-format";
import GCPSetupWizard from "../wizard/GCPSetupWizard";

/**
 * GCPSetup — the "GCP SETUP" group in Settings.
 *
 * Two ways to configure GCP (both push to Rust via cmd_set_gcp_config):
 *   1. Guided wizard — top row; recommended for first run.
 *   2. Manual edit — path + project inputs + Test button below.
 *
 * Both flows end with Rust's PopoState.gcp populated, which flips the
 * hotkey::on_release handler from fake_transcribe to the real Chirp 2
 * gRPC call.
 *
 * Sync strategy for the inline form:
 *   - Changes land in settingsStore.gcp immediately (UI responsiveness).
 *   - A debounced effect (500ms) pushes valid config to Rust. No spinner —
 *     the Test button is the explicit user-facing confirmation.
 *   - Test button does an `cmd_set_gcp_config` + `cmd_gcp_test_connection`
 *     back-to-back so "Test" always reflects the current input state,
 *     not whatever Rust cached last.
 */

export default function GCPSetup() {
  const gcp = useSettingsStore((s) => s.gcp);
  const updateGcp = useSettingsStore((s) => s.updateGcp);
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const hasCredentials =
    !!gcp.serviceAccountJsonPath && gcp.projectId.trim().length > 0;

  // On mount, ask Rust whether it has a config already (loaded from
  // %APPDATA%\popo\gcp.json at boot). If yes and our frontend store is
  // empty, backfill from Rust so the UI shows what's actually active.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        type GetResult = {
          configured: boolean;
          serviceAccountPath: string;
          projectId: string;
          languageCode: string;
        };
        const res = await invoke<GetResult>("cmd_get_gcp_config");
        if (cancelled) return;
        if (
          res.configured &&
          !gcp.serviceAccountJsonPath &&
          !gcp.projectId.trim()
        ) {
          updateGcp({
            serviceAccountJsonPath: res.serviceAccountPath,
            projectId: res.projectId,
          });
        }
      } catch {
        // Not in Tauri, or command not registered — silent.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced sync to Rust whenever both fields are non-empty.
  // This is what the old UI was missing — it just wrote to localStorage
  // and never told Rust. Without this, hotkey release falls through to
  // fake_transcribe forever.
  useEffect(() => {
    if (!hasCredentials) return;
    const handle = window.setTimeout(async () => {
      try {
        await invoke("cmd_set_gcp_config", {
          args: {
            serviceAccountPath: gcp.serviceAccountJsonPath ?? "",
            projectId: gcp.projectId.trim(),
            languageCode: "",
          },
        });
        // No toast / spinner — the Test button is the feedback surface.
      } catch (e) {
        // Intentionally silent: the user will see the error when they
        // click Test (or when dictation fails with a clear pill message).
        // eslint-disable-next-line no-console
        console.warn("cmd_set_gcp_config silent failure:", e);
      }
    }, 500);
    return () => window.clearTimeout(handle);
  }, [gcp.serviceAccountJsonPath, gcp.projectId, hasCredentials]);

  const handleTest = async () => {
    if (!hasCredentials) return;
    setTesting(true);
    setTestNote(null);
    try {
      // 1. Push the current form values to Rust (in case the debounce
      //    effect hasn't fired yet, or the user pressed Test right
      //    after editing).
      await invoke("cmd_set_gcp_config", {
        args: {
          serviceAccountPath: gcp.serviceAccountJsonPath ?? "",
          projectId: gcp.projectId.trim(),
          languageCode: "",
        },
      });

      // 2. Ask Rust to mint a real OAuth2 token against Google. This
      //    proves: (a) the service-account JSON parses, (b) the key
      //    is accepted by oauth2.googleapis.com, (c) the project has
      //    Speech-to-Text enabled (if the user scoped the token that
      //    way).
      const res = await invoke<{ ok: boolean; message: string }>(
        "cmd_gcp_test_connection",
      );

      updateGcp({
        lastConnectionTest: Date.now(),
        lastConnectionOk: res.ok,
      });
      setTestNote(res.message);
    } catch (e) {
      updateGcp({
        lastConnectionTest: Date.now(),
        lastConnectionOk: false,
      });
      setTestNote(String(e));
    } finally {
      setTesting(false);
    }
  };

  const handleBrowse = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: "JSON key", extensions: ["json"] }],
        title: "Select GCP service account key",
      });
      if (typeof selected === "string") {
        updateGcp({ serviceAccountJsonPath: selected });
      }
    } catch {
      // Non-Tauri context or user cancelled — ignore.
    }
  };

  return (
    <div>
      {/* Wizard launcher row — top position */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-4)",
          minHeight: 56,
          padding: "var(--sp-2) 0",
          borderBottom: "1px solid var(--border-faint)",
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontFamily: "var(--font-pixel-square)",
              fontSize: "var(--text-sm)",
              color: "var(--text-primary)",
            }}
          >
            Setup wizard
          </div>
          <div
            style={{
              marginTop: 2,
              fontFamily: "var(--font-pixel-line)",
              fontSize: "var(--text-xs)",
              color: "var(--text-secondary)",
            }}
          >
            {hasCredentials
              ? "Re-run to re-configure. Saves on the final step."
              : "Guided walkthrough — takes about three minutes."}
          </div>
        </div>
        <Button
          variant="primary"
          iconLeft={<Compass size={14} weight="regular" />}
          onClick={() => setWizardOpen(true)}
        >
          {hasCredentials ? "Re-run setup" : "Run setup wizard"}
        </Button>
      </div>

      {/* Path input row */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "var(--sp-4)",
          minHeight: 56,
          padding: "var(--sp-2) 0",
          borderBottom: "1px solid var(--border-faint)",
        }}
      >
        <div
          style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}
        >
          <div
            style={{
              fontFamily: "var(--font-pixel-square)",
              fontSize: "var(--text-sm)",
              color: "var(--text-primary)",
            }}
          >
            Service Account JSON
          </div>
          <div
            style={{
              fontFamily: "var(--font-pixel-line)",
              fontSize: "var(--text-xs)",
              color: "var(--text-secondary)",
            }}
          >
            Original path to the service-account key. popo never copies the
            JSON; moving or deleting it pauses Speech-to-Text and Vertex AI.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="text"
            placeholder="C:\path\to\popo-sa.json"
            value={gcp.serviceAccountJsonPath ?? ""}
            onChange={(e) =>
              updateGcp({ serviceAccountJsonPath: e.target.value || null })
            }
            spellCheck={false}
            style={{
              width: 280,
              height: 32,
              padding: "0 12px",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-button)",
              fontFamily: "var(--font-pixel-grid)",
              fontSize: "var(--text-xs)",
              lineHeight: 1.2,
              color: "var(--text-primary)",
              outline: "none",
            }}
          />
          <Button
            variant="ghost"
            iconLeft={<FolderOpen size={14} weight="regular" />}
            onClick={handleBrowse}
          >
            Browse
          </Button>
        </div>
      </div>

      {/* Project ID row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-4)",
          minHeight: 56,
          padding: "var(--sp-2) 0",
          borderBottom: "1px solid var(--border-faint)",
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontFamily: "var(--font-pixel-square)",
              fontSize: "var(--text-sm)",
              color: "var(--text-primary)",
            }}
          >
            Project ID
          </div>
          <div
            style={{
              fontFamily: "var(--font-pixel-line)",
              fontSize: "var(--text-xs)",
              color: "var(--text-secondary)",
              marginTop: 2,
            }}
          >
            Your GCP project identifier (lowercase, with hyphens).
          </div>
        </div>
        <input
          type="text"
          placeholder="popo-flow"
          value={gcp.projectId}
          onChange={(e) => updateGcp({ projectId: e.target.value })}
          spellCheck={false}
          style={{
            width: 240,
            height: 32,
            padding: "0 12px",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-button)",
            fontFamily: "var(--font-pixel-grid)",
            fontSize: "var(--text-xs)",
            lineHeight: 1.2,
            color: "var(--text-primary)",
            outline: "none",
          }}
        />
      </div>

      {/* Test connection row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-4)",
          minHeight: 56,
          padding: "var(--sp-2) 0",
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontFamily: "var(--font-pixel-square)",
              fontSize: "var(--text-sm)",
              color: "var(--text-primary)",
            }}
          >
            Test connection
          </div>
          <div
            style={{
              fontFamily: "var(--font-pixel-line)",
              fontSize: "var(--text-xs)",
              color: "var(--text-secondary)",
              marginTop: 2,
            }}
          >
            <TestStatus
              testing={testing}
              lastTest={gcp.lastConnectionTest}
              lastOk={gcp.lastConnectionOk}
              note={testNote}
            />
          </div>
        </div>
        <Button
          variant="subtle"
          iconLeft={<Lightning size={14} weight="regular" />}
          onClick={handleTest}
          disabled={testing || !hasCredentials}
        >
          {testing ? "Testing…" : "Test connection"}
        </Button>
      </div>

      <GCPSetupWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}

function TestStatus({
  testing,
  lastTest,
  lastOk,
  note,
}: {
  testing: boolean;
  lastTest: number | null;
  lastOk: boolean | null;
  note: string | null;
}) {
  if (testing) return <>Contacting Speech-to-Text v2…</>;
  if (lastTest == null) return <>Not tested yet.</>;
  if (lastOk === true) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Check size={12} color="var(--accent-success)" /> Connected ·{" "}
        {relativeTime(lastTest)}
        {note ? (
          <span style={{ color: "var(--text-ghost)", marginLeft: 6 }}>
            · {note}
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        flexWrap: "wrap",
      }}
    >
      <Warning size={12} color="var(--accent-error)" /> Last test failed ·{" "}
      {relativeTime(lastTest)}
      {note ? (
        <span style={{ color: "var(--text-ghost)", marginLeft: 6 }}>
          · {note}
        </span>
      ) : null}
    </span>
  );
}
