/**
 * Pins tool-gating inputs (embedded/sandboxed/clientCaps) per session so the
 * wire-level tools array stays byte-stable across turns of the same
 * conversation, even if isEmbeddedMode()/options.sandboxed/clientCaps drift
 * elsewhere in the process between turns.
 */
import { pruneMapToMaxSize } from "../infra/map-size.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("agent/tool-gating-pin");

type ToolGatingSnapshot = {
  embedded: boolean;
  sandboxed: boolean;
  clientCaps?: string[];
  sessionId?: string;
};

const toolGatingPins = new Map<string, ToolGatingSnapshot>();
const MAX_TOOL_GATING_PINS = 512;

function setPin(key: string, snapshot: ToolGatingSnapshot): void {
  if (toolGatingPins.has(key)) {
    toolGatingPins.delete(key);
  } else if (toolGatingPins.size >= MAX_TOOL_GATING_PINS) {
    pruneMapToMaxSize(toolGatingPins, MAX_TOOL_GATING_PINS - 1);
  }
  toolGatingPins.set(key, snapshot);
}

function copyClientCaps(clientCaps?: string[]): string[] | undefined {
  return clientCaps ? [...clientCaps] : undefined;
}

function sameClientCaps(a?: string[], b?: string[]): boolean {
  if (!a || !b) {
    // Both absent agrees; presence against absence is real drift the warning must catch. No
    // `a === b` fast path: identical references would hide a caller mutating a shared array.
    return !a && !b;
  }
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = a.toSorted();
  const sortedB = b.toSorted();
  return sortedA.every((value, index) => value === sortedB[index]);
}

/**
 * Freezes embedded/sandboxed/clientCaps the first time a session key is seen
 * and reuses that snapshot on later turns, so a live flip elsewhere in the
 * process (e.g. isEmbeddedMode()) cannot reshape an in-flight conversation's
 * tools array. A pin rotates only when both the stored and incoming sessionId are present and
 * differ (set on /new and /reset). A pin created without a sessionId never rotates on sessionId
 * alone, because rotating on a first-seen sessionId could itself flip the tools array between
 * turn 1 and turn 2 — the bug this pin exists to prevent. Pins are evicted least-recently-used
 * once more than MAX_TOOL_GATING_PINS session keys are live. Calls with no pinKey are not
 * tracked and always see live values.
 */
export function resolvePinnedToolGating(params: {
  pinKey?: string;
  embedded: boolean;
  sandboxed: boolean;
  clientCaps?: string[];
  sessionId?: string;
}): { embedded: boolean; sandboxed: boolean; clientCaps?: string[] } {
  const live = {
    embedded: params.embedded,
    sandboxed: params.sandboxed,
    clientCaps: params.clientCaps,
  };
  if (!params.pinKey) {
    return live;
  }
  const existing = toolGatingPins.get(params.pinKey);
  const isNewSession =
    !existing ||
    (Boolean(params.sessionId) &&
      Boolean(existing.sessionId) &&
      params.sessionId !== existing.sessionId);
  if (isNewSession) {
    // Store a copy: clientCaps arrives as per-turn caller state, and a snapshot that aliases it
    // would change shape when the caller reuses or mutates the array on a later turn.
    setPin(params.pinKey, {
      ...live,
      clientCaps: copyClientCaps(live.clientCaps),
      sessionId: params.sessionId,
    });
    return live;
  }
  const disagrees =
    existing.embedded !== live.embedded ||
    existing.sandboxed !== live.sandboxed ||
    !sameClientCaps(existing.clientCaps, live.clientCaps);
  if (disagrees) {
    log.warn("tool-gating pin disagreement: live inputs drifted from the pinned session snapshot", {
      pinKey: params.pinKey,
      pinned: {
        embedded: existing.embedded,
        sandboxed: existing.sandboxed,
        clientCaps: existing.clientCaps,
      },
      live,
    });
  }
  // Hit: re-insert so the map stays insertion-ordered by *use*. pruneMapToMaxSize evicts the
  // first key, and per-run key churn (cron mints per-run session keys) would otherwise drop an
  // actively used conversation's pin and silently re-pin it from live values mid-conversation.
  toolGatingPins.delete(params.pinKey);
  toolGatingPins.set(params.pinKey, existing);
  return {
    embedded: existing.embedded,
    sandboxed: existing.sandboxed,
    // Hand back a copy on hit turns for the same reason setPin stores one: this array reaches tool
    // construction every turn, and one consumer mutating it would reshape every later snapshot.
    // Turn one differs: it returns the caller's own array; only the stored snapshot is copied.
    clientCaps: copyClientCaps(existing.clientCaps),
  };
}

/** Clear all pinned tool-gating snapshots between isolated tests. */
export function resetToolGatingPinsForTests(): void {
  toolGatingPins.clear();
}
