/**
 * Pins the skills catalog prompt per session so the system prompt prefix stays
 * byte-identical across turns of one durable conversation.
 *
 * The cache boundary only protects providers that accept explicit cache breakpoints
 * (`cacheControlFormat: "anthropic"`). Everywhere else the boundary is stripped and the
 * whole system prompt is one cached string, so a single changed skill entry re-prefills
 * the entire transcript. AGENTS.md already makes deferred invalidation the default for
 * prompt-state mutations, so a catalog change lands on the next session instead of
 * busting the current one.
 */
import { createHash } from "node:crypto";
import { pruneMapToMaxSize } from "../infra/map-size.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("agent/prompt-skills-pin");

const MAX_SKILLS_PROMPT_PINS = 512;

type SkillsPromptPin = {
  skillsPrompt: string;
  /** Repeat drift is the same fact every turn; one warning per session is enough. */
  driftWarned: boolean;
};

const skillsPromptPins = new Map<string, SkillsPromptPin>();

function digestForLog(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function setPin(sessionKey: string, pin: SkillsPromptPin): void {
  if (skillsPromptPins.has(sessionKey)) {
    skillsPromptPins.delete(sessionKey);
  } else if (skillsPromptPins.size >= MAX_SKILLS_PROMPT_PINS) {
    pruneMapToMaxSize(skillsPromptPins, MAX_SKILLS_PROMPT_PINS - 1);
  }
  skillsPromptPins.set(sessionKey, pin);
}

/**
 * Returns the catalog this session's prompt must keep using. The first turn fixes the
 * value; later turns get the pinned copy even after the on-disk catalog drifts.
 */
export function pinSkillsPromptForSession(params: {
  sessionKey?: string;
  skillsPrompt?: string;
}): string | undefined {
  const { sessionKey, skillsPrompt } = params;
  if (!sessionKey || !skillsPrompt) {
    // Nothing to stabilize: a restricted or raw run carries no catalog, and a
    // sessionless build has no prefix that a later turn could reuse.
    return skillsPrompt;
  }

  const pinned = skillsPromptPins.get(sessionKey);
  if (!pinned) {
    setPin(sessionKey, { skillsPrompt, driftWarned: false });
    return skillsPrompt;
  }

  if (pinned.skillsPrompt !== skillsPrompt && !pinned.driftWarned) {
    pinned.driftWarned = true;
    // Digests and sizes only: the catalog can embed operator-authored text.
    log.warn(
      "skills prompt pin disagreement: catalog drifted mid-session, keeping the pinned copy until the next session",
      {
        sessionKey,
        pinnedChars: pinned.skillsPrompt.length,
        liveChars: skillsPrompt.length,
        pinnedDigest: digestForLog(pinned.skillsPrompt),
        liveDigest: digestForLog(skillsPrompt),
      },
    );
  }

  return pinned.skillsPrompt;
}

export function resetSkillsPromptPinsForTests(): void {
  skillsPromptPins.clear();
}
