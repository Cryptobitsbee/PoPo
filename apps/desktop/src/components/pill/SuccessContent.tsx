import { Check } from "@phosphor-icons/react";

/**
 * SuccessContent — pill inner surface after a successful paste.
 *
 * Per brief §2: single Phosphor `Check` centered at 12px, color
 * --accent-success. Held 300ms then Rust emits pill:state:sleep.
 */
export default function SuccessContent() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
      }}
    >
      <Check
        size={12}
        weight="regular"
        color="var(--accent-success)"
        aria-label="Paste succeeded"
      />
    </div>
  );
}
