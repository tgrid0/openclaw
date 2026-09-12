// Covers plugin-backed memory state registration and reset behavior.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildMemoryPromptSection,
  clearMemoryPluginState,
  getMemoryCapabilityRegistration,
  getMemoryRuntime,
  listMemoryCorpusSupplements,
  listMemoryPromptPreparations,
  listActiveMemoryPublicArtifacts,
  prepareMemoryPromptSection,
  registerMemoryCapability,
  registerMemoryCorpusSupplement,
  registerMemoryPromptPreparation,
  registerMemoryPromptSupplement,
  registerTestMemoryPromptBuilder,
  resetMemoryPromptSectionPinsForTests,
  resolveMemoryFlushPlan,
  type MemoryPluginPublicArtifact,
} from "./memory-state.test-fixtures.js";
import { createEmptyPluginRegistry } from "./registry-empty.js";
import { withPluginRegistrationContext } from "./runtime.js";

function createMemoryRuntime() {
  return {
    async getMemorySearchManager() {
      return { manager: null, error: "missing" };
    },
    resolveMemoryBackendConfig() {
      return { backend: "builtin" as const };
    },
  };
}

function createMemoryFlushPlan(relativePath: string) {
  return {
    softThresholdTokens: 1,
    forceFlushTranscriptBytes: 2,
    reserveTokensFloor: 3,
    prompt: relativePath,
    systemPrompt: relativePath,
    relativePath,
  };
}

function expectClearedMemoryState() {
  expect(resolveMemoryFlushPlan({})).toBeNull();
  expect(buildMemoryPromptSection({ availableTools: new Set(["memory_search"]) })).toStrictEqual(
    [],
  );
  expect(listMemoryCorpusSupplements()).toStrictEqual([]);
  expect(getMemoryRuntime()).toBeUndefined();
}

function registerMemoryState(params: {
  promptSection?: string[];
  relativePath?: string;
  runtime?: ReturnType<typeof createMemoryRuntime>;
}) {
  registerMemoryCapability("memory-core", {
    ...(params.promptSection ? { promptBuilder: () => params.promptSection ?? [] } : {}),
    ...(params.relativePath
      ? { flushPlanResolver: () => createMemoryFlushPlan(params.relativePath ?? "") }
      : {}),
    ...(params.runtime ? { runtime: params.runtime } : {}),
  });
}

describe("memory plugin state", () => {
  afterEach(() => {
    clearMemoryPluginState();
    resetMemoryPromptSectionPinsForTests();
  });

  it("returns empty defaults when no memory plugin state is registered", () => {
    expectClearedMemoryState();
  });

  it("attributes direct builder registrations to the synchronous plugin owner", () => {
    const building = createEmptyPluginRegistry();

    withPluginRegistrationContext(building, "actual-plugin", () => {
      registerMemoryCapability("spoofed-plugin", { runtime: createMemoryRuntime() });
      registerMemoryCorpusSupplement("spoofed-plugin", {
        search: async () => [],
        get: async () => null,
      });
      registerMemoryPromptSupplement("spoofed-plugin", () => ["supplement"]);
      registerMemoryPromptPreparation("spoofed-plugin", async () => ["prepared"]);
    });

    expect(building.memoryCapabilities[0]?.pluginId).toBe("actual-plugin");
    expect(building.memoryCorpusSupplements[0]?.pluginId).toBe("actual-plugin");
    expect(building.memoryPromptSupplements[0]?.pluginId).toBe("actual-plugin");
    expect(building.memoryPromptPreparations[0]?.pluginId).toBe("actual-plugin");
  });

  it("delegates prompt building to the registered memory plugin", () => {
    registerTestMemoryPromptBuilder(({ availableTools }) => {
      if (!availableTools.has("memory_search")) {
        return [];
      }
      return ["## Custom Memory", "Use custom memory tools.", ""];
    });

    expect(buildMemoryPromptSection({ availableTools: new Set(["memory_search"]) })).toEqual([
      "## Custom Memory",
      "Use custom memory tools.",
      "",
    ]);
  });

  it("lists active public memory artifacts in deterministic order", async () => {
    registerMemoryCapability("memory-core", {
      publicArtifacts: {
        async listArtifacts() {
          return [
            {
              kind: "daily-note",
              workspaceDir: "/tmp/workspace-b",
              relativePath: "memory/2026-04-06.md",
              absolutePath: "/tmp/workspace-b/memory/2026-04-06.md",
              agentIds: ["beta"],
              contentType: "markdown" as const,
            },
            {
              kind: "memory-root",
              workspaceDir: "/tmp/workspace-a",
              relativePath: "MEMORY.md",
              absolutePath: "/tmp/workspace-a/MEMORY.md",
              agentIds: ["main"],
              contentType: "markdown" as const,
            },
          ];
        },
      },
    });

    await expect(listActiveMemoryPublicArtifacts({ cfg: {} as never })).resolves.toEqual([
      {
        kind: "memory-root",
        workspaceDir: "/tmp/workspace-a",
        relativePath: "MEMORY.md",
        absolutePath: "/tmp/workspace-a/MEMORY.md",
        agentIds: ["main"],
        contentType: "markdown",
      },
      {
        kind: "daily-note",
        workspaceDir: "/tmp/workspace-b",
        relativePath: "memory/2026-04-06.md",
        absolutePath: "/tmp/workspace-b/memory/2026-04-06.md",
        agentIds: ["beta"],
        contentType: "markdown",
      },
    ]);
  });

  it("normalizes public memory artifacts without agent ids", async () => {
    const legacyArtifact = {
      kind: "memory-root",
      workspaceDir: "/tmp/workspace",
      relativePath: "MEMORY.md",
      absolutePath: "/tmp/workspace/MEMORY.md",
      contentType: "markdown" as const,
    } as Omit<MemoryPluginPublicArtifact, "agentIds"> as MemoryPluginPublicArtifact;

    registerMemoryCapability("memory-core", {
      publicArtifacts: {
        async listArtifacts() {
          return [legacyArtifact];
        },
      },
    });

    await expect(listActiveMemoryPublicArtifacts({ cfg: {} as never })).resolves.toEqual([
      {
        kind: "memory-root",
        workspaceDir: "/tmp/workspace",
        relativePath: "MEMORY.md",
        absolutePath: "/tmp/workspace/MEMORY.md",
        agentIds: [],
        contentType: "markdown",
      },
    ]);
  });

  it("drops malformed public memory artifacts instead of crashing the sort", async () => {
    // Record-shaped artifact as shipped by @mem0/openclaw-mem0 <= 1.0.14 —
    // none of the file-backed fields the sort dereferences.
    const recordShapedArtifact = {
      id: "mem0:memory:1",
      type: "memory",
      title: "A memory",
      content: "memory text",
    } as unknown as MemoryPluginPublicArtifact;

    registerMemoryCapability("openclaw-mem0", {
      publicArtifacts: {
        async listArtifacts() {
          return [
            recordShapedArtifact,
            {
              kind: "memory-root",
              workspaceDir: "/tmp/workspace",
              relativePath: "MEMORY.md",
              absolutePath: "/tmp/workspace/MEMORY.md",
              agentIds: ["main"],
              contentType: "markdown" as const,
            },
          ];
        },
      },
    });

    await expect(listActiveMemoryPublicArtifacts({ cfg: {} as never })).resolves.toEqual([
      {
        kind: "memory-root",
        workspaceDir: "/tmp/workspace",
        relativePath: "MEMORY.md",
        absolutePath: "/tmp/workspace/MEMORY.md",
        agentIds: ["main"],
        contentType: "markdown",
      },
    ]);
  });

  it("ignores a non-array public artifact listing", async () => {
    registerMemoryCapability("openclaw-mem0", {
      publicArtifacts: {
        async listArtifacts() {
          return { artifacts: [] } as unknown as MemoryPluginPublicArtifact[];
        },
      },
    });

    await expect(listActiveMemoryPublicArtifacts({ cfg: {} as never })).resolves.toEqual([]);
  });

  it("preserves sidecar runtime fields when a memory plugin adds public artifacts only", async () => {
    const runtime = createMemoryRuntime();
    const flushPlanResolver = () => createMemoryFlushPlan("memory/sidecar.md");

    registerMemoryCapability("memory-core", {
      flushPlanResolver,
      runtime,
    });
    registerMemoryCapability("memory-lancedb", {
      publicArtifacts: {
        async listArtifacts() {
          return [
            {
              kind: "memory-root",
              workspaceDir: "/tmp/workspace",
              relativePath: "MEMORY.md",
              absolutePath: "/tmp/workspace/MEMORY.md",
              agentIds: ["main"],
              contentType: "markdown" as const,
            },
          ];
        },
      },
    });

    expect(resolveMemoryFlushPlan({})?.relativePath).toBe("memory/sidecar.md");
    expect(getMemoryRuntime()).toBe(runtime);
    expect(getMemoryCapabilityRegistration()?.pluginId).toBe("memory-lancedb");
    await expect(listActiveMemoryPublicArtifacts({ cfg: {} as never })).resolves.toEqual([
      {
        kind: "memory-root",
        workspaceDir: "/tmp/workspace",
        relativePath: "MEMORY.md",
        absolutePath: "/tmp/workspace/MEMORY.md",
        agentIds: ["main"],
        contentType: "markdown",
      },
    ]);
  });

  it("preserves runtime fields when the same plugin adds public artifacts", () => {
    const runtime = createMemoryRuntime();
    const flushPlanResolver = () => createMemoryFlushPlan("memory/same-owner.md");

    registerMemoryCapability("memory-core", { runtime, flushPlanResolver });
    registerMemoryCapability("memory-core", {
      publicArtifacts: { listArtifacts: async () => [] },
    });

    expect(getMemoryRuntime()).toBe(runtime);
    expect(resolveMemoryFlushPlan({})?.relativePath).toBe("memory/same-owner.md");
  });

  it("passes citations mode through to the prompt builder", () => {
    registerTestMemoryPromptBuilder(({ citationsMode }) => [
      `citations: ${citationsMode ?? "default"}`,
    ]);

    expect(
      buildMemoryPromptSection({
        availableTools: new Set(),
        citationsMode: "off",
      }),
    ).toEqual(["citations: off"]);
  });

  it("passes agent context through the primary and supplemental prompt builders", () => {
    const primary = vi.fn(() => ["primary"]);
    const supplemental = vi.fn(() => ["supplemental"]);
    registerTestMemoryPromptBuilder(primary);
    registerMemoryPromptSupplement("memory-wiki", supplemental);

    const availableTools = new Set(["memory_search", "memory_get"]);
    expect(
      buildMemoryPromptSection({
        availableTools,
        citationsMode: "on",
        agentId: "marketing-agent",
        agentSessionKey: "agent:marketing-agent:main",
        sandboxed: true,
      }),
    ).toEqual(["primary", "supplemental"]);
    const expectedContext = {
      availableTools,
      citationsMode: "on",
      agentId: "marketing-agent",
      agentSessionKey: "agent:marketing-agent:main",
      sandboxed: true,
    };
    expect(primary).toHaveBeenCalledWith(expectedContext);
    expect(supplemental).toHaveBeenCalledWith(expectedContext);
  });

  it("appends prompt supplements in plugin-id order", () => {
    registerTestMemoryPromptBuilder(() => ["primary"]);
    registerMemoryPromptSupplement("memory-wiki", () => ["wiki"]);
    registerMemoryPromptSupplement("alpha-helper", () => ["alpha"]);

    expect(buildMemoryPromptSection({ availableTools: new Set() })).toEqual([
      "primary",
      "alpha",
      "wiki",
    ]);
  });

  it("ignores malformed prompt builder output", () => {
    registerTestMemoryPromptBuilder(() => ["primary", 1, undefined] as never);
    registerMemoryPromptSupplement("async-helper", () => Promise.resolve(["async"]) as never);
    registerMemoryPromptSupplement("valid-helper", () => ["valid", false] as never);

    expect(buildMemoryPromptSection({ availableTools: new Set() })).toEqual(["primary", "valid"]);
  });

  it("prepares immutable, frozen prompt lines before synchronous assembly", async () => {
    const prepare = vi.fn(async () => ["compiled once"]);
    registerMemoryPromptPreparation("memory-wiki", prepare);
    const params = {
      availableTools: new Set(["wiki_search"]),
      agentId: "main",
      agentSessionKey: "agent:main:main",
    };

    const prepared = await prepareMemoryPromptSection(params);

    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.context)).toBe(true);
    expect(Object.isFrozen(prepared.context.availableTools)).toBe(true);
    expect(Object.isFrozen(prepared.lines)).toBe(true);
    expect(buildMemoryPromptSection(params, prepared)).toEqual(["compiled once"]);
    expect(buildMemoryPromptSection(params, prepared)).toEqual(["compiled once"]);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  // Regression test for the prompt-cache-miss bug: prepareMemoryPromptSection used to recompute
  // on every call, so a memory write between two runs of the *same* durable session (e.g. a
  // continuation turn triggered by a webhook, hours later) changed the prepared lines' byte
  // content and busted the LLM provider's prompt-cache match on a turn that otherwise hadn't
  // changed. See memory-prompt-section-pin.ts.
  it("reuses the pinned snapshot on a later run of the same session instead of recomputing", async () => {
    let compiledLines = ["compiled before"];
    const prepare = vi.fn(async () => [...compiledLines]);
    registerMemoryPromptPreparation("memory-wiki", prepare);
    const params = {
      availableTools: new Set(["wiki_search"]),
      agentId: "main",
      agentSessionKey: "agent:main:main",
    };

    const first = await prepareMemoryPromptSection(params);
    // Simulates a memory write that happened after the first run finished.
    compiledLines = ["compiled after"];
    const second = await prepareMemoryPromptSection(params);

    // Same session, same context: the write's effect is deferred to the *next* genuinely new
    // session rather than immediately reshaping a session already in progress, per this repo's
    // stated policy (AGENTS.md: "Prompt-state mutations ... default to deferred cache
    // invalidation — effect next session").
    expect(second).toBe(first);
    expect(buildMemoryPromptSection(params, second)).toEqual(["compiled before"]);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("recomputes for a different session even when every other param matches", async () => {
    let compiledLines = ["compiled before"];
    const prepare = vi.fn(async () => [...compiledLines]);
    registerMemoryPromptPreparation("memory-wiki", prepare);
    const baseParams = { availableTools: new Set(["wiki_search"]), agentId: "main" };

    const first = await prepareMemoryPromptSection({
      ...baseParams,
      agentSessionKey: "agent:main:session-1",
    });
    compiledLines = ["compiled after"];
    const second = await prepareMemoryPromptSection({
      ...baseParams,
      agentSessionKey: "agent:main:session-2",
    });

    expect(second).not.toBe(first);
    expect(
      buildMemoryPromptSection({ ...baseParams, agentSessionKey: "agent:main:session-2" }, second),
    ).toEqual(["compiled after"]);
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it("recomputes when the run's own context changed, even for the same session key", async () => {
    let compiledLines = ["compiled before"];
    const prepare = vi.fn(async () => [...compiledLines]);
    registerMemoryPromptPreparation("memory-wiki", prepare);

    const first = await prepareMemoryPromptSection({
      availableTools: new Set(["wiki_search"]),
      agentId: "main",
      agentSessionKey: "agent:main:main",
    });
    compiledLines = ["compiled after"];
    // Available tools genuinely changed since the pinned run. Reusing the stale pin here would
    // later make buildMemoryPromptSection throw ("prepared memory prompt section does not match
    // the current run") instead of quietly doing the right thing, so this must recompute.
    const second = await prepareMemoryPromptSection({
      availableTools: new Set(["wiki_search", "memory_search"]),
      agentId: "main",
      agentSessionKey: "agent:main:main",
    });

    expect(second).not.toBe(first);
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  // Calls with no agentSessionKey are never tracked (matches tool-gating-pin's identical rule),
  // so a caller that cannot supply one (or intentionally opts out) always sees a fresh compute.
  it("never pins across calls that omit agentSessionKey", async () => {
    let compiledLines = ["compiled before"];
    const prepare = vi.fn(async () => [...compiledLines]);
    registerMemoryPromptPreparation("memory-wiki", prepare);
    const params = { availableTools: new Set(["wiki_search"]), agentId: "main" };

    const first = await prepareMemoryPromptSection(params);
    compiledLines = ["compiled after"];
    const second = await prepareMemoryPromptSection(params);

    expect(second).not.toBe(first);
    expect(buildMemoryPromptSection(params, second)).toEqual(["compiled after"]);
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it("rejects prepared state from a different run context", async () => {
    registerMemoryPromptPreparation("memory-wiki", async () => ["private wiki state"]);
    const prepared = await prepareMemoryPromptSection({
      availableTools: new Set(["wiki_search"]),
      agentId: "first",
      agentSessionKey: "agent:first:main",
    });

    expect(() =>
      buildMemoryPromptSection(
        {
          availableTools: new Set(["wiki_search"]),
          agentId: "second",
          agentSessionKey: "agent:second:main",
        },
        prepared,
      ),
    ).toThrow("prepared memory prompt section does not match the current run");
  });

  it("removes prompt preparations from future runs without mutating an in-flight snapshot", async () => {
    registerMemoryPromptPreparation("memory-wiki", async () => ["prepared wiki"]);
    const params = { availableTools: new Set<string>() };
    const prepared = await prepareMemoryPromptSection(params);

    clearMemoryPluginState();

    const afterRemoval = await prepareMemoryPromptSection(params);
    expect(buildMemoryPromptSection(params, prepared)).toEqual(["prepared wiki"]);
    expect(buildMemoryPromptSection(params, afterRemoval)).toEqual([]);
    expect(listMemoryPromptPreparations()).toEqual([]);
  });

  it("stores memory corpus supplements", async () => {
    const supplement = {
      search: async () => [{ corpus: "wiki", path: "sources/alpha.md", score: 1, snippet: "x" }],
      get: async () => null,
    };

    registerMemoryCorpusSupplement("memory-wiki", supplement);

    expect(listMemoryCorpusSupplements()).toHaveLength(1);
    await expect(
      listMemoryCorpusSupplements()[0]?.supplement.search({ query: "alpha" }),
    ).resolves.toEqual([{ corpus: "wiki", path: "sources/alpha.md", score: 1, snippet: "x" }]);
  });

  it("clearMemoryPluginState resets both registries", () => {
    registerMemoryState({
      promptSection: ["stale section"],
      relativePath: "memory/stale.md",
      runtime: createMemoryRuntime(),
    });

    clearMemoryPluginState();

    expectClearedMemoryState();
  });
});
