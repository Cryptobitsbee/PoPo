import { useEffect, useState, type ReactNode, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowRight,
  ArrowLeft,
  Lightning,
  Check,
  Warning,
  ArrowSquareOut,
} from "@phosphor-icons/react";
import Modal from "../shared/Modal";
import Button from "../shared/Button";
import Select from "../shared/Select";
import { useSettingsStore } from "../../store/settingsStore";

/**
 * VertexSetupWizard — guided setup for the Vertex AI Gemini provider.
 *
 * The Vertex analog of GCPSetupWizard. Vertex reuses the SAME service
 * account the user already configured in GCP Setup (for Chirp), so
 * there's no key to download here — the user only has to:
 *   0. Intro       — what Vertex is + the one prerequisite (GCP Setup)
 *   1. Enable API  — turn on the Vertex AI API in the console
 *   2. Grant role  — add roles/aiplatform.user to the service account
 *   3. Region + Test — pick a region, run a real generateContent ping
 *
 * On Finish, commits geminiProvider="vertex" + the region to the store
 * (which pushes to Rust via useApplySettingsToRust) so the next
 * dictation uses Vertex.
 */

export const VERTEX_REGIONS: { value: string; label: string }[] = [
  { value: "us-central1", label: "us-central1 (Iowa)" },
  { value: "us-east1", label: "us-east1 (S. Carolina)" },
  { value: "us-east4", label: "us-east4 (N. Virginia)" },
  { value: "us-west1", label: "us-west1 (Oregon)" },
  { value: "europe-west1", label: "europe-west1 (Belgium)" },
  { value: "europe-west2", label: "europe-west2 (London)" },
  { value: "europe-west3", label: "europe-west3 (Frankfurt)" },
  { value: "europe-west4", label: "europe-west4 (Netherlands)" },
  { value: "asia-south1", label: "asia-south1 (Mumbai)" },
  { value: "asia-southeast1", label: "asia-southeast1 (Singapore)" },
  { value: "asia-northeast1", label: "asia-northeast1 (Tokyo)" },
  { value: "australia-southeast1", label: "australia-southeast1 (Sydney)" },
  { value: "global", label: "global (auto-route)" },
];

const TOTAL_STEPS = 4;

export interface VertexSetupWizardProps {
  open: boolean;
  onClose: () => void;
}

export default function VertexSetupWizard({
  open,
  onClose,
}: VertexSetupWizardProps) {
  const gcp = useSettingsStore((s) => s.gcp);
  const updateGcp = useSettingsStore((s) => s.updateGcp);

  const [step, setStep] = useState(0);
  const [region, setRegion] = useState(gcp.vertexLocation || "us-central1");
  const [testState, setTestState] = useState<
    "idle" | "testing" | "ok" | "failed"
  >("idle");
  const [testNote, setTestNote] = useState<string | null>(null);

  const gcpReady =
    !!gcp.serviceAccountJsonPath && gcp.projectId.trim().length > 0;

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setRegion(gcp.vertexLocation || "us-central1");
    setTestState("idle");
    setTestNote(null);
  }, [open, gcp.vertexLocation]);

  const runTest = async () => {
    setTestState("testing");
    setTestNote(null);
    try {
      // Push provider + region to Rust so the test reflects the
      // wizard's current region selection.
      await invoke("cmd_set_gemini_provider", {
        provider: "vertex",
        location: region,
      });
      const res = await invoke<{ ok: boolean; message: string }>(
        "cmd_gemini_test_connection",
      );
      setTestState(res.ok ? "ok" : "failed");
      setTestNote(res.message);
    } catch (e) {
      setTestState("failed");
      setTestNote(String(e));
    }
  };

  // Auto-run the test when arriving at the final step.
  useEffect(() => {
    if (!open || step !== TOTAL_STEPS - 1) return;
    if (!gcpReady) {
      setTestState("failed");
      setTestNote("Finish GCP Setup first — Vertex reuses that service account.");
      return;
    }
    void runTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  const handleBack = () => setStep((s) => Math.max(0, s - 1));
  const handleNext = () => {
    if (step === TOTAL_STEPS - 1) {
      // Commit: switch the provider to Vertex + save the region.
      updateGcp({ geminiProvider: "vertex", vertexLocation: region });
      onClose();
      return;
    }
    setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1));
  };

  return (
    <Modal open={open} onClose={onClose} width={560} label="Vertex AI setup">
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
          Set up Vertex AI
        </h2>
        <StepIndicator current={step} total={TOTAL_STEPS} />
      </div>

      <div style={{ minHeight: 280 }}>
        {step === 0 && <IntroStep gcpReady={gcpReady} projectId={gcp.projectId} />}
        {step === 1 && <EnableApiStep projectId={gcp.projectId} />}
        {step === 2 && <GrantRoleStep />}
        {step === 3 && (
          <RegionTestStep
            region={region}
            onRegionChange={setRegion}
            testState={testState}
            testNote={testNote}
            onRetry={runTest}
          />
        )}
      </div>

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
            iconRight={
              step === TOTAL_STEPS - 1 ? (
                <Check size={14} weight="regular" />
              ) : (
                <ArrowRight size={14} weight="regular" />
              )
            }
          >
            {step === TOTAL_STEPS - 1 ? "Use Vertex AI" : "Next"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Steps ────────────────────────────────────────────────────────────

function IntroStep({
  gcpReady,
  projectId,
}: {
  gcpReady: boolean;
  projectId: string;
}) {
  return (
    <StepBody
      title="Why Vertex AI?"
      description="Vertex AI runs Gemini on Google Cloud. It reuses the exact same service account you set up for dictation in GCP Setup — there's no separate API key to create. You just turn on one API and grant one role."
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
          label="Prerequisite"
          value="A finished GCP Setup (service-account JSON + project ID). Vertex uses that same account."
        />
        <Fact
          label="What you do here"
          value="Enable the Vertex AI API, grant the Vertex AI User role, pick a region, test."
        />
        <Fact label="Cost" value="Billed to your own Google Cloud project, like Chirp." />
      </div>

      {!gcpReady && (
        <Callout tone="warn">
          GCP Setup isn't finished yet. Scroll down to{" "}
          <strong>GCP setup</strong> and connect your service account first —
          Vertex can't work without it.
        </Callout>
      )}
      {gcpReady && (
        <Callout tone="ok">
          Using service account from project{" "}
          <strong>{projectId || "(unknown)"}</strong>.
        </Callout>
      )}
    </StepBody>
  );
}

function EnableApiStep({ projectId }: { projectId: string }) {
  const apiUrl = projectId
    ? `https://console.cloud.google.com/apis/library/aiplatform.googleapis.com?project=${encodeURIComponent(projectId)}`
    : "https://console.cloud.google.com/apis/library/aiplatform.googleapis.com";
  return (
    <StepBody
      title="Enable the Vertex AI API"
      description="One click in the Google Cloud console. This turns on Gemini for your project."
    >
      <ol style={olStyle}>
        <Instruction>
          Open the <strong>Vertex AI API</strong> page for your project:
          <OpenLink url={apiUrl}>Enable Vertex AI API</OpenLink>
        </Instruction>
        <Instruction>
          Click <strong>Enable</strong>. If it's already on, you'll see
          &ldquo;Manage&rdquo; instead — that's fine, move on.
        </Instruction>
        <Instruction>
          Make sure you're in the same project as your dictation service
          account
          {projectId ? (
            <>
              {" "}
              (<RoleChip>{projectId}</RoleChip>)
            </>
          ) : null}
          .
        </Instruction>
      </ol>
    </StepBody>
  );
}

function GrantRoleStep() {
  return (
    <StepBody
      title="Grant the Vertex AI User role"
      description="Your service account needs permission to call Gemini. Add one role to the account you already created."
    >
      <ol style={olStyle}>
        <Instruction>
          Open <strong>IAM &amp; Admin → IAM</strong>:
          <OpenLink url="https://console.cloud.google.com/iam-admin/iam">
            Open IAM
          </OpenLink>
        </Instruction>
        <Instruction>
          Find your dictation service account (the one whose JSON key you
          picked in GCP Setup). Click the pencil to edit it.
        </Instruction>
        <Instruction>
          Click <strong>Add another role</strong> and choose{" "}
          <RoleChip>roles/aiplatform.user</RoleChip> (shown as
          &ldquo;Vertex AI User&rdquo;). Save.
        </Instruction>
        <Instruction>
          Changes can take a minute to apply. If the test on the next step
          fails with a permission error, wait a moment and retry.
        </Instruction>
      </ol>
    </StepBody>
  );
}

function RegionTestStep({
  region,
  onRegionChange,
  testState,
  testNote,
  onRetry,
}: {
  region: string;
  onRegionChange: (r: string) => void;
  testState: "idle" | "testing" | "ok" | "failed";
  testNote: string | null;
  onRetry: () => void;
}) {
  return (
    <StepBody
      title="Pick a region and test"
      description="Choose the region closest to you, then popo sends a tiny request to confirm everything works."
    >
      <div style={{ marginTop: "var(--sp-4)" }}>
        <Field label="Region">
          <Select
            value={region}
            options={VERTEX_REGIONS}
            onChange={onRegionChange}
            aria-label="Vertex region"
            minWidth={260}
          />
        </Field>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-pixel-square)",
              fontSize: "var(--text-sm)",
              color: "var(--text-primary)",
              lineHeight: 1.3,
            }}
          >
            {testState === "testing" && "Contacting Vertex AI…"}
            {testState === "ok" && "Vertex AI is ready"}
            {testState === "failed" && "Couldn't reach Vertex AI"}
            {testState === "idle" && "Preparing…"}
          </div>
          {testNote && (
            <div
              style={{
                fontFamily: "var(--font-pixel-line)",
                fontSize: "var(--text-xs)",
                color: "var(--text-secondary)",
                lineHeight: 1.4,
                wordBreak: "break-word",
              }}
            >
              {testNote}
            </div>
          )}
          {testState === "failed" && (
            <div style={{ marginTop: 6 }}>
              <Button
                variant="subtle"
                iconLeft={<Lightning size={14} weight="regular" />}
                onClick={onRetry}
              >
                Retry test
              </Button>
            </div>
          )}
        </div>
      </div>
    </StepBody>
  );
}

// ── Shared pieces ────────────────────────────────────────────────────

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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label
        style={{
          display: "block",
          marginBottom: 6,
          fontFamily: "var(--font-pixel-square)",
          fontSize: "var(--text-sm)",
          color: "var(--text-primary)",
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function Callout({
  tone,
  children,
}: {
  tone: "ok" | "warn";
  children: ReactNode;
}) {
  return (
    <div
      style={{
        marginTop: "var(--sp-5)",
        padding: "var(--sp-3) var(--sp-4)",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-button)",
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        fontFamily: "var(--font-pixel-line)",
        fontSize: "var(--text-xs)",
        lineHeight: 1.5,
        color: "var(--text-secondary)",
      }}
    >
      {tone === "ok" ? (
        <Check size={14} weight="regular" color="var(--accent-success)" />
      ) : (
        <Warning size={14} weight="regular" color="var(--accent-error)" />
      )}
      <span>{children}</span>
    </div>
  );
}

function RoleChip({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        padding: "2px 8px",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-micro)",
        fontFamily: "var(--font-pixel-grid)",
        fontSize: "var(--text-2xs)",
        color: "var(--text-primary)",
      }}
    >
      {children}
    </span>
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

function OpenLink({ url, children }: { url: string; children: ReactNode }) {
  const [opening, setOpening] = useState(false);
  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    setOpening(true);
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch {
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

const olStyle: CSSProperties = {
  marginTop: 16,
  marginBottom: 0,
  paddingLeft: 20,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};
