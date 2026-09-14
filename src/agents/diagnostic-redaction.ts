import { redactSecrets } from "../logging/redact.js";
import { sanitizeDiagnosticPayload } from "./payload-redaction.js";

export function redactAgentDiagnosticPayload(
  value: unknown,
  overrides?: Parameters<typeof sanitizeDiagnosticPayload>[1],
): unknown {
  return redactSecrets(sanitizeDiagnosticPayload(value, overrides));
}
