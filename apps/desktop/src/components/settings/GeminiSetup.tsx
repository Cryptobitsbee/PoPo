import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Lightning, Check, Warning, Compass } from "@phosphor-icons/react";
import SettingRow from "./SettingRow";
import Select from "../shared/Select";
import Input from "../shared/Input";
import Button from "../shared/Button";
import VertexSetupWizard, {
  VERTEX_REGIONS,
} from "../wizard/VertexSetupWizard";
import { useSettingsStore } from "../../store/settingsStore";

/**
 * GeminiSetup — the AI-provider sub-section of Settings → Transcription.
 *
 * Rendered only when Auto-format is on. Lets the user pick between:
 *   - AI Studio: a free key from ai.dev (x-goog-api-key).
 *   - Vertex AI: Google Cloud's Gemini, reusing the SAME service
 *     account the user configured in GCP Setup (no separate key).
 *
 * The provider is committed here in Settings and never auto-detected
 * on the dictation path. A "Setup guide" button opens VertexSetupWizard
 * (the Vertex analog of the Chirp GCP wizard) so users can actually
 * get Vertex working. A single Test connection row confirms the chosen
 * provider reaches a live model — the button stays put on the right and
 * the (possibly long) result lives in the left status line, truncated,
 * with the full message in a hover title.
 */

export default function GeminiSetup() {
  const gcp = useSettingsStore((s) => s.gcp);
  const updateGcp = useSettingsStore((s) => s.updateGcp);

  const isVertex = gcp.geminiProvider === "vertex";

  const [wizardOpen, setWizardOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [testNote, setTestNote] = useState<string | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setTestNote(null);
    try {
      // Push current credentials/provider so the test reflects what's
      // on screen even if the debounced sync hook hasn't fired yet.
      await invoke("cmd_set_gemini_api_key", { key: gcp.geminiApiKey ?? null });
      await invoke("cmd_set_gemini_provider", {
        provider: gcp.geminiProvider ?? "aistudio",
        location: gcp.vertexLocation ?? "us-central1",
      });
      const res = await invoke<{ ok: boolean; message: string }>(
        "cmd_gemini_test_connection",
      );
      setTestOk(res.ok);
      setTestNote(res.message);
    } catch (e) {
      setTestOk(false);
      setTestNote(String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      {/* Provider picker */}
      <SettingRow
        label="AI provider"
        hint="AI Studio uses a free API key from ai.dev — simplest to set up. Vertex AI runs Gemini on Google Cloud and reuses the service account from GCP Setup below — pick it if AI Studio's free limits are too tight."
      >
        <Select
          value={gcp.geminiProvider ?? "aistudio"}
          options={[
            { value: "aistudio", label: "AI Studio" },
            { value: "vertex", label: "Vertex AI" },
          ]}
          onChange={(v) =>
            updateGcp({ geminiProvider: v as "aistudio" | "vertex" })
          }
          aria-label="AI provider"
          minWidth={160}
        />
      </SettingRow>

      {/* AI Studio: API key */}
      {!isVertex && (
        <SettingRow
          label="Gemini API key"
          description={
            <>
              Free key from{" "}
              <a
                href="#"
                onClick={async (e) => {
                  e.preventDefault();
                  try {
                    const { openUrl } =
                      await import("@tauri-apps/plugin-opener");
                    await openUrl("https://aistudio.google.com/app/apikey");
                  } catch {
                    /* ignore */
                  }
                }}
                style={{
                  color: "var(--text-primary)",
                  textDecoration: "underline",
                  cursor: "pointer",
                }}
              >
                ai.dev
              </a>
              . Stored locally.
            </>
          }
        >
          <Input
            type="password"
            value={gcp.geminiApiKey ?? ""}
            onChange={(e) => updateGcp({ geminiApiKey: e.target.value })}
            placeholder="AIza…"
            monospace
            style={{ minWidth: 220 }}
            autoComplete="off"
            spellCheck={false}
          />
        </SettingRow>
      )}

      {/* Vertex: guided setup + region */}
      {isVertex && (
        <>
          <SettingRow
            label="Vertex AI"
            description="Reuses your GCP service account."
            hint="Vertex needs the Vertex AI API enabled and the Vertex AI User role (roles/aiplatform.user) on the same service account you configured in GCP Setup. The setup guide walks you through both, step by step."
          >
            <Button
              variant="primary"
              iconLeft={<Compass size={14} weight="regular" />}
              onClick={() => setWizardOpen(true)}
            >
              Setup guide
            </Button>
          </SettingRow>

          <SettingRow label="Region" hint="Where your Vertex requests are served. Pick the region closest to you; 'global' lets Google route automatically.">
            <Select
              value={gcp.vertexLocation || "us-central1"}
              options={VERTEX_REGIONS}
              onChange={(v) => updateGcp({ vertexLocation: v })}
              aria-label="Vertex region"
              minWidth={240}
            />
          </SettingRow>
        </>
      )}

      {/* Connection test — button fixed on the right; status (and any
          long error) lives in the left description line, truncated. */}
      <SettingRow
        label="Test connection"
        description={
          <TestStatusLine testing={testing} ok={testOk} note={testNote} />
        }
        last
      >
        <Button
          variant="subtle"
          iconLeft={<Lightning size={14} weight="regular" />}
          onClick={handleTest}
          disabled={testing}
        >
          {testing ? "Testing\u2026" : "Test connection"}
        </Button>
      </SettingRow>

      <VertexSetupWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
      />
    </>
  );
}

/**
 * Compact one-line test status. Truncates long provider errors to a
 * single clamped line (full text in the hover title) so the row height
 * never balloons and the Test button stays anchored.
 */
function TestStatusLine({
  testing,
  ok,
  note,
}: {
  testing: boolean;
  ok: boolean | null;
  note: string | null;
}) {
  if (testing) return <>Contacting the provider…</>;
  if (ok == null) return <>Not tested yet.</>;

  const Icon = ok ? Check : Warning;
  const color = ok ? "var(--accent-success)" : "var(--accent-error)";
  const label = ok ? "Connected" : "Failed";
  const full = note ?? (ok ? "Connected." : "Test failed.");

  return (
    <span
      title={full}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        maxWidth: "100%",
      }}
    >
      <Icon size={12} weight="regular" color={color} style={{ flexShrink: 0 }} />
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
        {note ? ` \u00b7 ${note}` : ""}
      </span>
    </span>
  );
}
