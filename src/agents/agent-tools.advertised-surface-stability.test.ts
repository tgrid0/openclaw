/**
 * The advertised tool array is part of the provider prompt-cache prefix, so it must
 * not depend on per-turn sender state. Owner-only control-plane tools used to be
 * subtracted for turns carrying an explicit non-owner verdict, which re-prefilled the
 * whole conversation at every run boundary. Enforcement moved to execution time in
 * `tools/owner-only-tool-execution.ts`; these assertions pin the array shape that fix
 * created and fail on the visibility-gating model it replaced.
 */
import { describe, expect, it } from "vitest";
import "./test-helpers/fast-bash-tools.js";
import "./test-helpers/fast-coding-tools.js";
import "./test-helpers/fast-openclaw-tools.js";
import { GATEWAY_OWNER_ONLY_CORE_TOOLS } from "../security/dangerous-tools.js";
import { createOpenClawCodingTools } from "./agent-tools.js";

function advertisedToolNames(senderIsOwner: boolean | undefined): string[] {
  return createOpenClawCodingTools({ webSearchEnabled: false, senderIsOwner })
    .map((tool) => tool.name)
    .sort();
}

describe("advertised tool array stability", () => {
  it("advertises one tool set for owner, senderless, and non-owner turns", () => {
    const ownerNames = advertisedToolNames(true);

    // Pre-fix the non-owner set was strictly smaller, which is exactly the drift that
    // invalidated the cached prefix; a senderless turn already matched the owner turn.
    expect(advertisedToolNames(undefined)).toEqual(ownerNames);
    expect(advertisedToolNames(false)).toEqual(ownerNames);
  });

  it("keeps owner-only control-plane tools in the compared bundle", () => {
    // Without this the equality above could pass vacuously if the harness never built
    // the gated tools. This stub bundle provides a subset of them.
    const advertised = new Set(advertisedToolNames(false));
    const gatedInBundle = GATEWAY_OWNER_ONLY_CORE_TOOLS.filter((name) => advertised.has(name));

    expect(gatedInBundle.length).toBeGreaterThan(0);
    expect(gatedInBundle).toContain("automations");
    expect(gatedInBundle).toContain("conversations_send");
  });
});
