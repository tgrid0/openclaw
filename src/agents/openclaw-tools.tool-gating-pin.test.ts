// Verifies session-pinned tool-gating stays stable across a live embedded/sandboxed/clientCaps flip.
import { afterEach, describe, expect, it, vi } from "vitest";

const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));
vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: () => ({ warn: warnMock, debug: vi.fn(), isEnabled: () => false }),
}));

import {
  resetToolGatingPinsForTests,
  resolvePinnedToolGating,
} from "./openclaw-tools.tool-gating-pin.js";

// Mirrors MAX_TOOL_GATING_PINS in the pin module; local so the cap is not a test-only export.
const PIN_CAP = 512;

describe("resolvePinnedToolGating", () => {
  afterEach(() => {
    resetToolGatingPinsForTests();
    warnMock.mockClear();
  });

  it("returns live values unchanged when no pin key is given", () => {
    const first = resolvePinnedToolGating({ embedded: false, sandboxed: false });
    const second = resolvePinnedToolGating({ embedded: true, sandboxed: true });

    expect(first).toEqual({ embedded: false, sandboxed: false, clientCaps: undefined });
    expect(second).toEqual({ embedded: true, sandboxed: true, clientCaps: undefined });
  });

  it("pins the first snapshot seen for a session key and reuses it on later calls", () => {
    const first = resolvePinnedToolGating({
      pinKey: "agent:main:main",
      embedded: false,
      sandboxed: false,
      clientCaps: ["a"],
    });
    const second = resolvePinnedToolGating({
      pinKey: "agent:main:main",
      embedded: true,
      sandboxed: true,
      clientCaps: ["a", "b"],
    });

    expect(first).toEqual({ embedded: false, sandboxed: false, clientCaps: ["a"] });
    expect(second).toEqual({ embedded: false, sandboxed: false, clientCaps: ["a"] });
  });

  it("logs a disagreement when live inputs drift from the pin", () => {
    resolvePinnedToolGating({ pinKey: "agent:main:main", embedded: false, sandboxed: false });
    resolvePinnedToolGating({ pinKey: "agent:main:main", embedded: true, sandboxed: false });

    expect(warnMock).toHaveBeenCalledOnce();
    expect(warnMock.mock.calls[0]?.[0]).toContain("tool-gating pin disagreement");
  });

  it("does not log when repeated calls agree with the pin", () => {
    resolvePinnedToolGating({ pinKey: "agent:main:main", embedded: false, sandboxed: false });
    resolvePinnedToolGating({ pinKey: "agent:main:main", embedded: false, sandboxed: false });

    expect(warnMock).not.toHaveBeenCalled();
  });

  it("starts a fresh pin when the session id changes for the same key", () => {
    resolvePinnedToolGating({
      pinKey: "agent:main:main",
      embedded: false,
      sandboxed: false,
      sessionId: "session-1",
    });
    const afterReset = resolvePinnedToolGating({
      pinKey: "agent:main:main",
      embedded: true,
      sandboxed: true,
      sessionId: "session-2",
    });

    expect(afterReset).toEqual({ embedded: true, sandboxed: true, clientCaps: undefined });
  });

  it("keeps the existing pin when a later call omits sessionId", () => {
    resolvePinnedToolGating({
      pinKey: "agent:main:main",
      embedded: false,
      sandboxed: false,
      sessionId: "session-1",
    });
    const stillPinned = resolvePinnedToolGating({
      pinKey: "agent:main:main",
      embedded: true,
      sandboxed: true,
    });

    expect(stillPinned).toEqual({ embedded: false, sandboxed: false, clientCaps: undefined });
  });

  it("refreshes pin recency on a hit so eviction is least-recently-used", () => {
    resolvePinnedToolGating({ pinKey: "agent:idle:main", embedded: false, sandboxed: false });
    // The repeatedly-hit pin must disagree with every live call the churn makes on it. Passing the
    // pinned values would let a mid-loop eviction silently re-pin identical values in the same
    // iteration, so both the pre- and post-recency-refresh maps would satisfy every assertion.
    resolvePinnedToolGating({ pinKey: "agent:active:main", embedded: false, sandboxed: false });

    // Cron runs mint per-run session keys, so a busy instance churns past the cap while a
    // long-lived conversation is hit every turn. Insertion-order eviction would drop that
    // conversation's pin and silently re-pin it from live values with no disagreement warning.
    const pinnedActive = { embedded: false, sandboxed: false, clientCaps: undefined };
    let driftHits = 0;
    for (let index = 0; index <= PIN_CAP; index += 1) {
      resolvePinnedToolGating({ pinKey: `agent:run:${index}`, embedded: true, sandboxed: true });
      // Each drifting turn of the long-lived conversation has to win with the pinned snapshot and
      // warn exactly once; eviction returns live values and swallows the warning.
      expect(
        resolvePinnedToolGating({ pinKey: "agent:active:main", embedded: true, sandboxed: true }),
      ).toEqual(pinnedActive);
      driftHits += 1;
      expect(warnMock).toHaveBeenCalledTimes(driftHits);
    }

    // The repeatedly-hit pin survived the churn and still wins over live drift.
    expect(
      resolvePinnedToolGating({ pinKey: "agent:active:main", embedded: true, sandboxed: true }),
    ).toEqual(pinnedActive);
    expect(warnMock).toHaveBeenCalledTimes(driftHits + 1);

    // Cap-exercise guard plus LRU ordering: the never-hit idle pin is the oldest entry, so it is
    // the one that got evicted and silently re-pins from live values with no warning. That
    // eviction is only reachable once the churn really reaches MAX_TOOL_GATING_PINS, so if the
    // production cap ever grows past this loop's reach the churn is a no-op and this assertion
    // fails loudly instead of the whole test passing vacuously.
    expect(
      resolvePinnedToolGating({ pinKey: "agent:idle:main", embedded: true, sandboxed: true }),
    ).toEqual({ embedded: true, sandboxed: true, clientCaps: undefined });
    expect(warnMock).toHaveBeenCalledTimes(driftHits + 1);
  });

  it("keeps the snapshot when a session-id-free pin meets a session-id-bearing call", () => {
    // Rotating on first-seen sessionId could itself flip the tool set between turn 1 and turn 2,
    // which is the bug this pin exists to prevent, so the original pin stays.
    resolvePinnedToolGating({ pinKey: "agent:main:main", embedded: false, sandboxed: false });
    const withSessionId = resolvePinnedToolGating({
      pinKey: "agent:main:main",
      embedded: true,
      sandboxed: true,
      sessionId: "session-1",
    });

    expect(withSessionId).toEqual({ embedded: false, sandboxed: false, clientCaps: undefined });
  });

  it("treats clientCaps as a set when comparing against the pin", () => {
    resolvePinnedToolGating({
      pinKey: "agent:main:main",
      embedded: false,
      sandboxed: false,
      clientCaps: ["ui-commands", "inline-widgets"],
    });
    const second = resolvePinnedToolGating({
      pinKey: "agent:main:main",
      embedded: false,
      sandboxed: false,
      clientCaps: ["inline-widgets", "ui-commands"],
    });

    expect(second).toEqual({
      embedded: false,
      sandboxed: false,
      clientCaps: ["ui-commands", "inline-widgets"],
    });
    expect(warnMock).not.toHaveBeenCalled();
  });

  it("warns when a later turn omits clientCaps the pin has", () => {
    resolvePinnedToolGating({
      pinKey: "agent:main:main",
      embedded: false,
      sandboxed: false,
      clientCaps: ["ui-commands"],
    });
    const second = resolvePinnedToolGating({
      pinKey: "agent:main:main",
      embedded: false,
      sandboxed: false,
    });

    expect(warnMock).toHaveBeenCalledOnce();
    expect(warnMock.mock.calls[0]?.[0]).toContain("tool-gating pin disagreement");
    expect(second).toEqual({ embedded: false, sandboxed: false, clientCaps: ["ui-commands"] });
  });

  it("does not alias a caller-owned clientCaps array through the pin", () => {
    const callerCaps = ["ui-commands"];
    resolvePinnedToolGating({
      pinKey: "agent:main:main",
      embedded: false,
      sandboxed: false,
      clientCaps: callerCaps,
    });

    // Turn 1's array is per-turn state; mutating it (caller reuse, or a downstream consumer that
    // receives the pinned array every turn) must not reshape the cross-turn snapshot.
    callerCaps[0] = "tool-events";
    callerCaps.push("inline-widgets");

    const second = resolvePinnedToolGating({
      pinKey: "agent:main:main",
      embedded: false,
      sandboxed: false,
      clientCaps: ["ui-commands"],
    });
    expect(second).toEqual({ embedded: false, sandboxed: false, clientCaps: ["ui-commands"] });
    expect(second.clientCaps).not.toBe(callerCaps);
    expect(warnMock).not.toHaveBeenCalled();

    second.clientCaps?.push("tool-events");
    expect(
      resolvePinnedToolGating({
        pinKey: "agent:main:main",
        embedded: false,
        sandboxed: false,
        clientCaps: ["ui-commands"],
      }),
    ).toEqual({ embedded: false, sandboxed: false, clientCaps: ["ui-commands"] });
    expect(warnMock).not.toHaveBeenCalled();
  });

  it("keeps independent pins for different session keys", () => {
    const a = resolvePinnedToolGating({
      pinKey: "agent:a:main",
      embedded: false,
      sandboxed: false,
    });
    const b = resolvePinnedToolGating({ pinKey: "agent:b:main", embedded: true, sandboxed: true });

    expect(a).toEqual({ embedded: false, sandboxed: false, clientCaps: undefined });
    expect(b).toEqual({ embedded: true, sandboxed: true, clientCaps: undefined });
  });
});
