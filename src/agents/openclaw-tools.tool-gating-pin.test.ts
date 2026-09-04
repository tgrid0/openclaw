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

  it("keeps independent pins for different session keys", () => {
    const a = resolvePinnedToolGating({ pinKey: "agent:a:main", embedded: false, sandboxed: false });
    const b = resolvePinnedToolGating({ pinKey: "agent:b:main", embedded: true, sandboxed: true });

    expect(a).toEqual({ embedded: false, sandboxed: false, clientCaps: undefined });
    expect(b).toEqual({ embedded: true, sandboxed: true, clientCaps: undefined });
  });
});
