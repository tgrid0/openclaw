/**
 * Pins the prepared memory/skills prompt section per durable session so the
 * cache-stable system-prompt prefix (system-prompt.ts's cacheStablePromptPrefix,
 * keyed off a hash that includes memorySection) does not change on every
 * contextEngine.assemble() call — only when a genuinely new session starts, or
 * when the run's own context (available tools, citations mode, sandboxed)
 * legitimately changed. Mirrors ../agents/openclaw-tools.tool-gating-pin.ts.
 *
 * Without this, prepareMemoryPromptSection recomputes fresh on every run of a
 * durable session (e.g. a continuation turn hours later, triggered by a
 * webhook), and any memory write since the session's prior run changes the
 * prepared lines' byte content — busting the LLM provider's prompt-cache
 * match on the very next turn even though nothing about *that* turn's
 * request changed. This contradicts this repo's own stated policy (AGENTS.md:
 * "Prompt-state mutations (skills/tools/memory) default to deferred cache
 * invalidation — effect next session; immediate invalidation is an explicit
 * opt-in") — the memory write's effect should surface starting the *next*
 * session, not immediately reshape a session already in progress.
 */
import { pruneMapToMaxSize } from "../infra/map-size.js";
import type { PreparedMemoryPromptSection } from "./registry-contribution-types.js";

const memoryPromptSectionPins = new Map<string, PreparedMemoryPromptSection>();
const MAX_MEMORY_PROMPT_SECTION_PINS = 512;

function setPin(key: string, prepared: PreparedMemoryPromptSection): void {
  if (memoryPromptSectionPins.has(key)) {
    memoryPromptSectionPins.delete(key);
  } else if (memoryPromptSectionPins.size >= MAX_MEMORY_PROMPT_SECTION_PINS) {
    pruneMapToMaxSize(memoryPromptSectionPins, MAX_MEMORY_PROMPT_SECTION_PINS - 1);
  }
  memoryPromptSectionPins.set(key, prepared);
}

function sortedToolsMatch(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tool, index) => tool === b[index]);
}

function contextMatches(
  a: PreparedMemoryPromptSection["context"],
  b: PreparedMemoryPromptSection["context"],
): boolean {
  return (
    a.citationsMode === b.citationsMode &&
    a.agentId === b.agentId &&
    a.agentSessionKey === b.agentSessionKey &&
    a.sandboxed === b.sandboxed &&
    sortedToolsMatch(a.availableTools, b.availableTools)
  );
}

/**
 * Returns the pinned PreparedMemoryPromptSection for pinKey when one exists and
 * its snapshot context still matches freshContext (same availableTools,
 * citationsMode, agentId, sandboxed) — i.e. nothing that would legitimately
 * require a recompute has changed since it was pinned. Returns undefined on a
 * miss (no pin key, no pin yet, or a context mismatch); the caller must then
 * compute a fresh section and pass it to setPinnedMemoryPromptSection.
 *
 * Gating the hit on a full context match (not just the pin key) is what keeps
 * this safe: buildMemoryPromptSection throws if a prepared section's context
 * ever disagrees with the run it is handed to, so reusing a stale pin across a
 * genuine context change (e.g. available tools changed between runs) would
 * turn a correctness safeguard into a crash instead of quietly doing the right
 * thing — recomputing.
 */
export function getPinnedMemoryPromptSection(
  pinKey: string | undefined,
  freshContext: PreparedMemoryPromptSection["context"],
): PreparedMemoryPromptSection | undefined {
  if (!pinKey) {
    return undefined;
  }
  const existing = memoryPromptSectionPins.get(pinKey);
  if (!existing || !contextMatches(existing.context, freshContext)) {
    return undefined;
  }
  // Hit: re-insert so the map stays insertion-ordered by *use* (same rationale as
  // tool-gating-pin's identical move — per-run key churn elsewhere must not evict an
  // actively-used conversation's pin).
  memoryPromptSectionPins.delete(pinKey);
  memoryPromptSectionPins.set(pinKey, existing);
  return existing;
}

/** Pins prepared for pinKey so a later same-session, same-context call reuses it. A no-op without a pinKey — unkeyed calls are never tracked and always recompute. */
export function setPinnedMemoryPromptSection(
  pinKey: string | undefined,
  prepared: PreparedMemoryPromptSection,
): void {
  if (!pinKey) {
    return;
  }
  setPin(pinKey, prepared);
}

/** Clear all pinned memory prompt sections between isolated tests. */
export function resetMemoryPromptSectionPinsForTests(): void {
  memoryPromptSectionPins.clear();
}
