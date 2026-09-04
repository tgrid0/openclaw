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

function sameClientCaps(a?: string[], b?: string[]): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

/**
 * Freezes embedded/sandboxed/clientCaps the first time a session key is seen
 * and reuses that snapshot on later turns, so a live flip elsewhere in the
 * process (e.g. isEmbeddedMode()) cannot reshape an in-flight conversation's
 * tools array. A new sessionId for the same key (set on /new and /reset)
 * starts a fresh pin, since that is a genuinely new conversation. Calls with
 * no pinKey are not tracked and always see live values.
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
    (Boolean(params.sessionId) && Boolean(existing.sessionId) && params.sessionId !== existing.sessionId);
  if (isNewSession) {
    setPin(params.pinKey, { ...live, sessionId: params.sessionId });
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
  return {
    embedded: existing.embedded,
    sandboxed: existing.sandboxed,
    clientCaps: existing.clientCaps,
  };
}

/** Clear all pinned tool-gating snapshots between isolated tests. */
export function resetToolGatingPinsForTests(): void {
  toolGatingPins.clear();
}
