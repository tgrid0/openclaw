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

/**
 * `automations` is excluded deliberately: scheduler authorization is owned by the
 * creator-authority gate inside the cron tool (`cronCreateRequiresCreatorAuthority`),
 * which decides from the requested job's trigger and tools allow rather than from
 * the sender verdict alone. The inherited visibility deny singled the same tool out
 * for the same reason, so an owner-only check here would override its real owner and
 * refuse creation the admitted run was explicitly authorized to make.
 */
const OWNER_ONLY_GUARDED_TOOL_NAMES = new Set<string>(
  GATEWAY_OWNER_ONLY_CORE_TOOLS.filter((name) => name !== AUTOMATIONS_TOOL_NAME),
);

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

/**
 * Wraps owner-only tools so a refused turn gets `ToolAuthorizationError` when it
 * calls the tool, rather than relying on the tool being absent from the prompt.
 * Identity-independent on purpose: the verdict arrives with the turn, so a run
 * that could not resolve caller identity must not silently drop an explicit refusal.
 *
 * Returns the original array untouched unless the verdict actually refuses, so the
 * owner/absent path adds no wrappers.
 */
export function wrapToolsWithOwnerOnlyExecution(
  tools: AnyAgentTool[],
  senderIsOwner: boolean | undefined,
): AnyAgentTool[] {
  if (!deniesOwnerOnlyToolAccess(senderIsOwner)) {
    return tools;
  }
  return tools.map((tool) => {
    if (!OWNER_ONLY_GUARDED_TOOL_NAMES.has(tool.name) || !tool.execute) {
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
