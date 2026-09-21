/**
 * Owner-only control-plane tools must be refused when they run, not merely kept
 * out of the prompt. Visibility-only gating reshaped the wire tools array
 * between turns of one session (busting the provider prompt-cache prefix) and
 * left the tools unchecked on any path that still advertised them.
 */
import { describe, expect, it } from "vitest";
import { GATEWAY_OWNER_ONLY_CORE_TOOLS } from "../../security/dangerous-tools.js";
import type { AnyAgentTool } from "./common.js";
import { ToolAuthorizationError } from "./common.js";
import {
  deniesOwnerOnlyToolAccess,
  wrapToolsWithOwnerOnlyExecution,
} from "./owner-only-tool-execution.js";

function executableTool(name: string): AnyAgentTool {
  return {
    name,
    label: name,
    description: `${name} fixture`,
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [{ type: "text", text: `${name} ran` }] }),
  } as unknown as AnyAgentTool;
}

function findTool(tools: AnyAgentTool[], name: string): AnyAgentTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`fixture missing tool ${name}`);
  }
  return tool;
}

describe("owner-only tool execution guard", () => {
  it("refuses every owner-only core tool for an explicitly non-owner turn", async () => {
    // Invariant, not a sampled list: a tool added to GATEWAY_OWNER_ONLY_CORE_TOOLS
    // later must be refused here too.
    const wrapped = wrapToolsWithOwnerOnlyExecution(
      GATEWAY_OWNER_ONLY_CORE_TOOLS.map((name) => executableTool(name)),
      false,
    );

    for (const name of GATEWAY_OWNER_ONLY_CORE_TOOLS) {
      await expect(findTool(wrapped, name).execute("call-id", {})).rejects.toThrow(
        ToolAuthorizationError,
      );
    }
  });

  it.each([
    { label: "owner turn", senderIsOwner: true },
    { label: "turn with no sender identity", senderIsOwner: undefined },
  ])("runs owner-only tools for the $label", async ({ senderIsOwner }) => {
    // Absent identity is not a refusal: host-local CLI and trusted router
    // admissions carry no per-sender verdict, and losing the session's own
    // capability on those turns is the silent-failure class this replaces.
    const wrapped = wrapToolsWithOwnerOnlyExecution(
      [executableTool("portal"), executableTool("sessions")],
      senderIsOwner,
    );

    await expect(findTool(wrapped, "portal").execute("call-id", {})).resolves.toBeDefined();
    await expect(findTool(wrapped, "sessions").execute("call-id", {})).resolves.toBeDefined();
  });

  it("leaves non-owner-only tools callable for a non-owner turn", async () => {
    const wrapped = wrapToolsWithOwnerOnlyExecution([executableTool("read")], false);

    await expect(findTool(wrapped, "read").execute("call-id", {})).resolves.toBeDefined();
  });

  it("refuses without any resolved caller identity", async () => {
    // The guard reads the verdict carried by the turn, so a run that could not
    // resolve agentId/sessionKey cannot drop an explicit refusal.
    const standalone = wrapToolsWithOwnerOnlyExecution([executableTool("terminal")], false);

    await expect(findTool(standalone, "terminal").execute("call-id", {})).rejects.toThrow(
      ToolAuthorizationError,
    );
  });

  it.each([
    { label: "absent", senderIsOwner: undefined, denies: false },
    { label: "owner", senderIsOwner: true, denies: false },
    { label: "non-owner", senderIsOwner: false, denies: true },
  ])("reads a $label verdict as the single tri-state", ({ senderIsOwner, denies }) => {
    expect(deniesOwnerOnlyToolAccess(senderIsOwner)).toBe(denies);
  });
});
