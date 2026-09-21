// Owner-only control-plane tool enforcement at execution time.
//
// `GATEWAY_OWNER_ONLY_CORE_TOOLS` used to be enforced only by omitting those
// tools from the model-facing array. That made prompt visibility carry
// authorization's job, with two costs: the wire `tools` array changed shape
// between turns of one durable session (invalidating the provider prompt cache
// for the whole request prefix), and a tool that did reach the wire on some path
// had no check at all. Enforcement lives here so the advertised surface can stay
// byte-stable per session.
import { GATEWAY_OWNER_ONLY_CORE_TOOLS } from "../../security/dangerous-tools.js";
import { copyAgentToolMetadata } from "../agent-tool-metadata.js";
import { AUTOMATIONS_TOOL_NAME } from "./automations-tool-name.js";
import type { AnyAgentTool } from "./common.js";
import { ToolAuthorizationError } from "./common.js";

const OWNER_ONLY_CORE_TOOL_NAMES = new Set<string>(GATEWAY_OWNER_ONLY_CORE_TOOLS);

export type OwnerOnlyExecutionCarveOut = {
  /**
   * A fresh creator-authority capability is bound for this run, so `automations`
   * is authorized by the cron creator-authority gate (`cronCreateRequiresCreatorAuthority`,
   * which judges the requested job's trigger and tools allow) instead of by the
   * sender verdict. The visibility rule this replaced carved the same tool out under
   * the same condition; a blanket owner refusal here would override that owner and
   * break scheduling an admitted run was explicitly authorized to make.
   */
  automationCreatorAuthorityAvailable?: boolean;
};

/**
 * Single home for the owner verdict's tri-state. An explicitly non-owner sender
 * is refused; an absent verdict is not a refusal. Host-local CLI and trusted
 * router admissions carry no per-sender identity at all, and absent provenance
 * must not change an authorization decision — a run that cannot name its sender
 * keeps the session's own capability instead of silently losing it.
 */
export function deniesOwnerOnlyToolAccess(senderIsOwner: boolean | undefined): boolean {
  return senderIsOwner === false;
}

function deniesToolExecution(
  toolName: string,
  senderIsOwner: boolean | undefined,
  carveOut: OwnerOnlyExecutionCarveOut | undefined,
): boolean {
  if (!OWNER_ONLY_CORE_TOOL_NAMES.has(toolName)) {
    return false;
  }
  if (toolName === AUTOMATIONS_TOOL_NAME && carveOut?.automationCreatorAuthorityAvailable) {
    return false;
  }
  return deniesOwnerOnlyToolAccess(senderIsOwner);
}

/**
 * Wraps owner-only tools so a refused turn gets `ToolAuthorizationError` when it
 * calls the tool, rather than relying on the tool being absent from the prompt.
 * Identity-independent on purpose: the verdict arrives with the turn, so a run
 * that could not resolve caller identity must not silently drop an explicit refusal.
 *
 * Returns the original array untouched unless something is actually refused, so the
 * owner/absent path adds no wrappers.
 */
export function wrapToolsWithOwnerOnlyExecution(
  tools: AnyAgentTool[],
  senderIsOwner: boolean | undefined,
  carveOut?: OwnerOnlyExecutionCarveOut,
): AnyAgentTool[] {
  if (!tools.some((tool) => deniesToolExecution(tool.name, senderIsOwner, carveOut))) {
    return tools;
  }
  return tools.map((tool) => {
    if (!deniesToolExecution(tool.name, senderIsOwner, carveOut) || !tool.execute) {
      return tool;
    }
    const guarded: AnyAgentTool = {
      ...tool,
      execute: async () => {
        throw new ToolAuthorizationError(
          `The ${tool.name} tool is owner-only and this turn's sender is not the owner. ` +
            `Ask the owner to run it, or relay the request to an owner-authenticated conversation.`,
        );
      },
    };
    copyAgentToolMetadata(tool, guarded);
    return guarded;
  });
}
