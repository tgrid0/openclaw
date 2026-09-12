// Verifies session-pinned memory prompt sections stay stable across runs of the same session.
import { afterEach, describe, expect, it } from "vitest";
import {
  getPinnedMemoryPromptSection,
  resetMemoryPromptSectionPinsForTests,
  setPinnedMemoryPromptSection,
} from "./memory-prompt-section-pin.js";
import type { PreparedMemoryPromptSection } from "./registry-contribution-types.js";

// Mirrors MAX_MEMORY_PROMPT_SECTION_PINS in the pin module; local so the cap is not a test-only export.
const PIN_CAP = 512;

function makeContext(
  overrides: Partial<PreparedMemoryPromptSection["context"]> = {},
): PreparedMemoryPromptSection["context"] {
  return Object.freeze({
    availableTools: Object.freeze(["memory_search"]),
    citationsMode: "on" as const,
    agentId: "main",
    agentSessionKey: "agent:main:main",
    sandboxed: false,
    ...overrides,
  });
}

function makePrepared(
  lines: readonly string[],
  contextOverrides: Partial<PreparedMemoryPromptSection["context"]> = {},
): PreparedMemoryPromptSection {
  return Object.freeze({
    context: makeContext(contextOverrides),
    lines: Object.freeze([...lines]),
  });
}

describe("memory prompt section pin", () => {
  afterEach(() => {
    resetMemoryPromptSectionPinsForTests();
  });

  it("misses when no pin key is given", () => {
    expect(getPinnedMemoryPromptSection(undefined, makeContext())).toBeUndefined();
    // A no-key set must also be a no-op — nothing to reuse on a later lookup.
    setPinnedMemoryPromptSection(undefined, makePrepared(["a"]));
    expect(getPinnedMemoryPromptSection(undefined, makeContext())).toBeUndefined();
  });

  it("misses on the first call for a session key", () => {
    expect(getPinnedMemoryPromptSection("agent:main:main", makeContext())).toBeUndefined();
  });

  it("hits on a later call for the same session key with matching context", () => {
    const prepared = makePrepared(["compiled before"]);
    setPinnedMemoryPromptSection("agent:main:main", prepared);

    expect(getPinnedMemoryPromptSection("agent:main:main", makeContext())).toBe(prepared);
  });

  it("misses when available tools differ from the pinned context", () => {
    setPinnedMemoryPromptSection("agent:main:main", makePrepared(["compiled before"]));

    const missed = getPinnedMemoryPromptSection(
      "agent:main:main",
      makeContext({ availableTools: Object.freeze(["memory_search", "memory_get"]) }),
    );
    expect(missed).toBeUndefined();
  });

  it("misses when available tools order differs but content is the same set — order is not identity here", () => {
    // availableTools is already sorted by snapshotMemoryPromptContext before it reaches this
    // module, so a genuine reorder without a content change should not happen in practice; this
    // guards the comparison itself stays positional rather than treating any reorder as a match.
    setPinnedMemoryPromptSection(
      "agent:main:main",
      makePrepared(["compiled before"], {
        availableTools: Object.freeze(["memory_get", "memory_search"]),
      }),
    );

    const missed = getPinnedMemoryPromptSection(
      "agent:main:main",
      makeContext({ availableTools: Object.freeze(["memory_search", "memory_get"]) }),
    );
    expect(missed).toBeUndefined();
  });

  it("misses when citationsMode, agentId, or sandboxed differ from the pinned context", () => {
    setPinnedMemoryPromptSection("agent:main:main", makePrepared(["compiled before"]));

    expect(
      getPinnedMemoryPromptSection("agent:main:main", makeContext({ citationsMode: "off" })),
    ).toBeUndefined();
    expect(
      getPinnedMemoryPromptSection("agent:main:main", makeContext({ agentId: "other" })),
    ).toBeUndefined();
    expect(
      getPinnedMemoryPromptSection("agent:main:main", makeContext({ sandboxed: true })),
    ).toBeUndefined();
  });

  it("keeps independent pins for different session keys", () => {
    const preparedA = makePrepared(["a"], { agentSessionKey: "agent:a:main" });
    const preparedB = makePrepared(["b"], { agentSessionKey: "agent:b:main" });
    setPinnedMemoryPromptSection("agent:a:main", preparedA);
    setPinnedMemoryPromptSection("agent:b:main", preparedB);

    expect(
      getPinnedMemoryPromptSection("agent:a:main", makeContext({ agentSessionKey: "agent:a:main" })),
    ).toBe(preparedA);
    expect(
      getPinnedMemoryPromptSection("agent:b:main", makeContext({ agentSessionKey: "agent:b:main" })),
    ).toBe(preparedB);
  });

  it("overwrites the pin for a session key on a fresh set", () => {
    setPinnedMemoryPromptSection("agent:main:main", makePrepared(["compiled before"]));
    const preparedAfter = makePrepared(["compiled after"]);
    setPinnedMemoryPromptSection("agent:main:main", preparedAfter);

    expect(getPinnedMemoryPromptSection("agent:main:main", makeContext())).toBe(preparedAfter);
  });

  it("evicts the least-recently-used pin once past the cap, honouring hit recency", () => {
    const kept = makePrepared(["kept"], { agentSessionKey: "agent:kept:main" });
    setPinnedMemoryPromptSection("agent:kept:main", kept);

    for (let index = 0; index < PIN_CAP; index += 1) {
      const key = `agent:run:${index}`;
      setPinnedMemoryPromptSection(key, makePrepared([key], { agentSessionKey: key }));
      // Touch the long-lived pin on every iteration so it stays newest-by-use and survives the
      // churn; insertion-order-only eviction would instead drop it partway through this loop.
      expect(
        getPinnedMemoryPromptSection("agent:kept:main", makeContext({ agentSessionKey: "agent:kept:main" })),
      ).toBe(kept);
    }

    // The never-touched-again first churn entry is now the oldest and should have been evicted.
    expect(
      getPinnedMemoryPromptSection(
        "agent:run:0",
        makeContext({ agentSessionKey: "agent:run:0" }),
      ),
    ).toBeUndefined();
    // The long-lived, repeatedly-hit pin survived the whole churn.
    expect(
      getPinnedMemoryPromptSection("agent:kept:main", makeContext({ agentSessionKey: "agent:kept:main" })),
    ).toBe(kept);
  });
});
