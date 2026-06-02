import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowRight,
  ArrowLeft,
  FolderOpen,
  Lightning,
  Check,
  Warning,
  ArrowSquareOut,
} from "@phosphor-icons/react";
import Modal from "../shared/Modal";
import Button from "../shared/Button";
import Input from "../shared/Input";
import { useSettingsStore } from "../../store/settingsStore";

/**
 * GCPSetupWizard — multi-step onboarding flow for first-time GCP setup.
 *
 * Launched from Settings → GCP Setup → "Run setup wizard" button.
 *
 * 5 steps, all inside the shared Modal primitive:
 *   0. Intro      — what popo does with GCP, cost estimate
 *   1. Project    — create GCP project, enable Speech-to-Text v2 API
 *   2. Service account — create SA, grant role, download JSON key
 *   3. Point to key — native file picker + project ID input
 *   4. Test       — verify the inputs (simulated in Phase 4; real gRPC
 *                   ping lands in Phase 2 [6])
 *
 * Local state for path + project ID during the flow; committed to
 * `settingsStore.gcp` only when the user hits Finish on step 4. Closing
 * early preserves the previous stored values — no half-written state.
 *
 * External URLs open in the system default browser via
 * `@tauri-apps/plugin-opener`. File picker uses
 * `@tauri-apps/plugin-dialog`. Both installed in Session 11.
 */

const TOTAL_STEPS = 5;

export interface GCPSetupWizardProps {
  open: boolean;
  onClose: () => void;
}

export default function GCPSetupWizard({ open, onClose }: GCPSetupWizardProps) {
  const gcp = useSettingsStore((s) => s.gcp);
  const updateGcp = useSettingsStore((s) => s.updateGcp);

  const [step, setStep] = useState(0);
  const [path, setPath] = useState<string | null>(gcp.serviceAccountJsonPath);
  const [projectId, setProjectId] = useState(gcp.projectId);
  const [testState, setTestState] = useState<
    "idle" | "testing" | "ok" | "failed"
  >("idle");
  const [testNote, setTestNote] = useState<string | null>(null);

  // Reset on open — pre-fill with latest stored values.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setPath(gcp.serviceAccountJsonPath);
    setProjectId(gcp.projectId);
    setTestState("idle");
    setTestNote(null);
  }, [open, gcp.serviceAccountJsonPath, gcp.projectId]);

  const canProceedFromStep3 =
    (path?.trim().length ?? 0) > 0 && projectId.trim().length > 0;

  const handleBack = () => setStep((s) => Math.max(0, s - 1));

  const handleNext = async () => {
    if (step === 3 && !canProceedFromStep3) return;
    if (step === TOTAL_STEPS - 1) {
      // Finish: push to Rust (real Chirp auth cache), then commit to
      // frontend store, then close.
      try {
        await invoke("cmd_set_gcp_config", {
          args: {
            serviceAccountPath: path ?? "",
            projectId: projectId.trim(),
            languageCode: "",
          },
        });
      } catch (e) {
        // Surface the error inline instead of closing the wizard, so
        // the user can fix bad input without starting over.
        setTestState("failed");
        setTestNote(`Rust validation failed: ${String(e)}`);
        setStep(4);
        return;
      }

      updateGcp({
        serviceAccountJsonPath: path ?? null,
        projectId: projectId.trim(),
        lastConnectionTest: Date.now(),
        lastConnectionOk: testState === "ok",
      });
      onClose();
      return;
    }
    setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1));
  };

  // Auto-run the real GCP token test when entering step 4.
  useEffect(() => {
    if (!open) return;
    if (step !== 4) return;
    if (!canProceedFromStep3) {
      setTestState("failed");
      setTestNote("Missing path or project ID — go back to step 4.");
      return;
    }
    setTestState("testing");
    setTestNote(null);

    let cancelled = false;
    (async () => {
      // Push the candidate config to Rust, which validates the
      // service-account JSON parses and mints a real OAuth2 token.
      try {
        await invoke("cmd_set_gcp_config", {
          args: {
            serviceAccountPath: path ?? "",
            projectId: projectId.trim(),
            languageCode: "",
          },
        });
      } catch (e) {
        if (cancelled) return;
        setTestState("failed");
        setTestNote(`Invalid config: ${String(e)}`);
        return;
      }

      // Ask Rust to actually mint a token — that proves the SA JSON
      // is valid AND the network can reach oauth2.googleapis.com.
      try {
        const res = await invoke<{ ok: boolean; message: string }>(
          "cmd_gcp_test_connection",
        );
        if (cancelled) return;
        if (res.ok) {
          setTestState("ok");
          setTestNote(res.message);
        } else {
          setTestState("failed");
          setTestNote(res.message);
        }
      } catch (e) {
        if (cancelled) return;
        setTestState("failed");
        setTestNote(`Test call failed: ${String(e)}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, step, path, projectId, canProceedFromStep3]);

  return (
    <Modal open={open} onClose={onClose} width={560} label="GCP setup wizard">
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--sp-4)",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-pixel-square)",
            fontSize: "var(--text-lg)",
            fontWeight: 500,
            lineHeight: 1.2,
            color: "var(--text-primary)",
          }}
        >
          Connect GCP
        </h2>
        <StepIndicator current={step} total={TOTAL_STEPS} />
      </div>

      {/* Body */}
      <div style={{ minHeight: 280 }}>
        {step === 0 && <IntroStep />}
        {step === 1 && <ProjectStep />}
        {step === 2 && <ServiceAccountStep />}
        {step === 3 && (
          <KeyStep
            path={path}
            projectId={projectId}
            onPathChange={setPath}
            onProjectIdChange={setProjectId}
          />
        )}
        {step === 4 && (
          <TestStep
            testState={testState}
            testNote={testNote}
            path={path}
            projectId={projectId}
          />
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: "var(--sp-8)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "var(--sp-3)",
        }}
      >
        <Button
          variant="ghost"
          onClick={handleBack}
          disabled={step === 0}
          iconLeft={<ArrowLeft size={14} weight="regular" />}
        >
          Back
        </Button>

        <div style={{ display: "flex", gap: "var(--sp-2)" }}>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={handleNext}
            disabled={step === 3 && !canProceedFromStep3}
            iconRight={
              step === TOTAL_STEPS - 1 ? (
                <Check size={14} weight="regular" />
              ) : (
                <ArrowRight size={14} weight="regular" />
              )
            }
          >
            {step === TOTAL_STEPS - 1 ? "Finish" : "Next"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Step indicator (dot row) ─────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          style={{
            width: i === current ? 16 : 6,
            height: 6,
            borderRadius: 9999,
            background:
              i === current
                ? "var(--text-primary)"
                : i < current
                  ? "var(--text-secondary)"
                  : "var(--border-subtle)",
            transition: "width 150ms ease, background-color 150ms ease",
            display: "block",
          }}
        />
      ))}
    </div>
  );
}

// ── Step 0: Intro ────────────────────────────────────────────────────

function IntroStep() {
  return (
    <StepBody
      title="Why connect GCP?"
      description="popo transcribes through Google Cloud Speech-to-Text (Chirp). You pay Google directly — popo itself is free. Takes about three minutes."
    >
      <div
        style={{
          marginTop: "var(--sp-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-3)",
        }}
      >
        <Fact
          label="Cost"
          value="$0.016 / minute after the first 60 minutes per month (free)."
        />
        <Fact
          label="What you need"
          value="A Google account with billing enabled and a GCP project you can manage."
        />
        <Fact
          label="What popo stores"
          value="Only a path to your service-account JSON on your machine. The key never leaves your device."
        />
      </div>
    </StepBody>
  );
}

// ── Step 1: GCP project + API ───────────────────────────────────────

function ProjectStep() {
  return (
    <StepBody
      title="Create a project and enable the API"
      description="Pick or create a project in the GCP console, then turn on Speech-to-Text v2."
    >
      <ol style={olStyle}>
        <Instruction>
          Open the <strong>GCP console</strong>:
          <OpenLink url="https://console.cloud.google.com/projectcreate">
            Create project
          </OpenLink>
        </Instruction>
        <Instruction>
          Enable <strong>Speech-to-Text v2 API</strong> on your project:
          <OpenLink url="https://console.cloud.google.com/apis/library/speech.googleapis.com">
            Enable API
          </OpenLink>
        </Instruction>
        <Instruction>
          Make sure <strong>billing</strong> is enabled — Speech-to-Text won't
          run without it (the 60-min monthly free tier still applies).
        </Instruction>
      </ol>
    </StepBody>
  );
}

// ── Step 2: Service account ──────────────────────────────────────────

function ServiceAccountStep() {
  return (
    <StepBody
      title="Create a service account"
      description="popo uses a service-account JSON key (no browser login loop, no OAuth dance)."
    >
      <ol style={olStyle}>
        <Instruction>
          Go to <strong>IAM &amp; Admin → Service Accounts</strong>:
          <OpenLink url="https://console.cloud.google.com/iam-admin/serviceaccounts">
            Open service accounts
          </OpenLink>
        </Instruction>
        <Instruction>
          Click <strong>Create service account</strong>. Give it any name (e.g.{" "}
          <kbd style={kbdStyle}>popo-dictation</kbd>).
        </Instruction>
        <Instruction>
          Grant it the <strong>Cloud Speech Client</strong> role:
          <span
            style={{
              display: "inline-flex",
              marginLeft: 6,
              padding: "2px 8px",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-micro)",
              fontFamily: "var(--font-pixel-grid)",
              fontSize: "var(--text-2xs)",
              color: "var(--text-primary)",
            }}
          >
            roles/speech.client
          </span>
        </Instruction>
        <Instruction>
          Open the service account → <strong>Keys</strong> →{" "}
          <strong>Add Key → Create new key → JSON</strong>. Save the downloaded
          file somewhere safe.
        </Instruction>
      </ol>
    </StepBody>
  );
}

// ── Step 3: Point popo to the key ────────────────────────────────────

function KeyStep({
  path,
  projectId,
  onPathChange,
  onProjectIdChange,
}: {
  path: string | null;
  projectId: string;
  onPathChange: (p: string | null) => void;
  onProjectIdChange: (p: string) => void;
}) {
  const [picking, setPicking] = useState(false);

  const handleBrowse = async () => {
    setPicking(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: "JSON key", extensions: ["json"] }],
        title: "Select GCP service account key",
      });
      if (typeof selected === "string") {
        onPathChange(selected);
      }
    } catch {
      // Outside Tauri (or user cancelled) — do nothing.
    } finally {
      setPicking(false);
    }
  };

  return (
    <StepBody
      title="Point popo to your key"
      description="Select the JSON file you downloaded and enter your project ID."
    >
      <div
        style={{
          marginTop: "var(--sp-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-4)",
        }}
      >
        <Field
          label="Service account JSON"
          description="popo stores only the file path. The key stays on your disk."
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Input
                monospace
                value={path ?? ""}
                onChange={(e) => onPathChange(e.target.value || null)}
                placeholder="C:\Users\you\Downloads\key.json"
                spellCheck={false}
              />
            </div>
            <Button
              variant="subtle"
              iconLeft={<FolderOpen size={14} weight="regular" />}
              onClick={handleBrowse}
              disabled={picking}
            >
              {picking ? "Picking…" : "Browse"}
            </Button>
          </div>
        </Field>

        <Field
          label="Project ID"
          description="Lowercase letters, digits, hyphens (e.g. popo-dictation-1234)."
        >
          <Input
            monospace
            value={projectId}
            onChange={(e) => onProjectIdChange(e.target.value)}
            placeholder="my-gcp-project"
            spellCheck={false}
            autoComplete="off"
          />
        </Field>
      </div>
    </StepBody>
  );
}

// ── Step 4: Test ─────────────────────────────────────────────────────

function TestStep({
  testState,
  testNote,
  path,
  projectId,
}: {
  testState: "idle" | "testing" | "ok" | "failed";
  testNote: string | null;
  path: string | null;
  projectId: string;
}) {
  return (
    <StepBody
      title="Verify your setup"
      description="popo checks the inputs look valid. A real API ping happens once the Rust backend is wired."
    >
      <div
        style={{
          marginTop: "var(--sp-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-2)",
        }}
      >
        <Summary label="Key file" value={path ?? "—"} monospace />
        <Summary label="Project ID" value={projectId || "—"} monospace />
      </div>

      <div
        style={{
          marginTop: "var(--sp-6)",
          padding: "var(--sp-4)",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-button)",
          display: "flex",
          alignItems: "flex-start",
          gap: "var(--sp-3)",
        }}
      >
        <TestIcon state={testState} />
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div
            style={{
              fontFamily: "var(--font-pixel-square)",
              fontSize: "var(--text-sm)",
              color: "var(--text-primary)",
              lineHeight: 1.3,
            }}
          >
            {testState === "testing" && "Contacting Speech-to-Text v2…"}
            {testState === "ok" && "Ready to dictate"}
            {testState === "failed" && "Check your inputs"}
            {testState === "idle" && "Preparing…"}
          </div>
          {testNote && (
            <div
              style={{
                fontFamily: "var(--font-pixel-line)",
                fontSize: "var(--text-xs)",
                color: "var(--text-secondary)",
                lineHeight: 1.4,
              }}
            >
              {testNote}
            </div>
          )}
        </div>
      </div>
    </StepBody>
  );
}

// ── Shared small pieces ──────────────────────────────────────────────

function StepBody({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <h3
        style={{
          margin: 0,
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-base)",
          fontWeight: 500,
          lineHeight: 1.3,
          color: "var(--text-primary)",
        }}
      >
        {title}
      </h3>
      <p
        style={{
          marginTop: 6,
          marginBottom: 0,
          fontFamily: "var(--font-pixel-line)",
          fontSize: "var(--text-sm)",
          lineHeight: 1.5,
          color: "var(--text-secondary)",
        }}
      >
        {description}
      </p>
      {children}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px 1fr",
        gap: "var(--sp-3)",
        alignItems: "baseline",
      }}
    >
      <span
        style={{
          // Session 53: unified section-heading style.
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-sm)",
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-pixel-line)",
          fontSize: "var(--text-sm)",
          lineHeight: 1.5,
          color: "var(--text-primary)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Instruction({ children }: { children: ReactNode }) {
  return (
    <li
      style={{
        fontFamily: "var(--font-pixel-line)",
        fontSize: "var(--text-sm)",
        lineHeight: 1.6,
        color: "var(--text-primary)",
      }}
    >
      {children}
    </li>
  );
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label
        style={{
          display: "block",
          marginBottom: 4,
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-sm)",
          color: "var(--text-primary)",
        }}
      >
        {label}
      </label>
      {description && (
        <div
          style={{
            marginBottom: 8,
            fontFamily: "var(--font-pixel-line)",
            fontSize: "var(--text-xs)",
            color: "var(--text-secondary)",
            lineHeight: 1.4,
          }}
        >
          {description}
        </div>
      )}
      {children}
    </div>
  );
}

function Summary({
  label,
  value,
  monospace,
}: {
  label: string;
  value: string;
  monospace?: boolean;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px 1fr",
        gap: "var(--sp-3)",
        alignItems: "baseline",
      }}
    >
      <span
        style={{
          // Session 53: unified section-heading style.
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-sm)",
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: monospace
            ? "var(--font-pixel-grid)"
            : "var(--font-pixel-line)",
          fontSize: "var(--text-xs)",
          color: "var(--text-primary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function TestIcon({ state }: { state: "idle" | "testing" | "ok" | "failed" }) {
  if (state === "testing" || state === "idle") {
    return <Lightning size={18} weight="regular" color="var(--text-ghost)" />;
  }
  if (state === "ok") {
    return <Check size={18} weight="regular" color="var(--accent-success)" />;
  }
  return <Warning size={18} weight="regular" color="var(--accent-error)" />;
}

/** Small inline "open external URL" link that routes through the
 *  opener plugin so the URL opens in the user's system default browser. */
function OpenLink({ url, children }: { url: string; children: ReactNode }) {
  const [opening, setOpening] = useState(false);
  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    setOpening(true);
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch {
      // Non-Tauri context fallback: normal anchor behavior.
      window.open(url, "_blank", "noopener");
    } finally {
      setOpening(false);
    }
  };
  return (
    <a
      href={url}
      onClick={handleClick}
      rel="noopener noreferrer"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        marginLeft: 6,
        color: "var(--text-primary)",
        textDecoration: "underline",
        textDecorationColor: "var(--border-default)",
        textUnderlineOffset: 3,
        opacity: opening ? 0.6 : 1,
        cursor: "pointer",
        fontFamily: "var(--font-pixel-square)",
        fontSize: "var(--text-sm)",
      }}
    >
      {children}
      <ArrowSquareOut size={11} weight="regular" />
    </a>
  );
}

// ── Shared styles (deduped) ──────────────────────────────────────────

const olStyle: React.CSSProperties = {
  marginTop: 16,
  marginBottom: 0,
  paddingLeft: 20,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const kbdStyle: React.CSSProperties = {
  display: "inline-flex",
  padding: "2px 6px",
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-micro)",
  fontFamily: "var(--font-pixel-grid)",
  fontSize: "var(--text-2xs)",
  color: "var(--text-primary)",
};
