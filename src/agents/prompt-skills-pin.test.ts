import { beforeEach, describe, expect, it, vi } from "vitest";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: () => ({ warn, info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import { pinSkillsPromptForSession, resetSkillsPromptPinsForTests } from "./prompt-skills-pin.js";

const FIRST_CATALOG = "## Skills\n- deploy: runbook";
const DRIFTED_CATALOG = "## Skills\n- deploy: runbook\n- triage: new skill added mid-session";

describe("session skills prompt pin", () => {
  beforeEach(() => {
    resetSkillsPromptPinsForTests();
    warn.mockClear();
  });

  it("keeps the first-turn catalog after the live catalog drifts", () => {
    expect(pinSkillsPromptForSession({ sessionKey: "s1", skillsPrompt: FIRST_CATALOG })).toBe(
      FIRST_CATALOG,
    );

    expect(pinSkillsPromptForSession({ sessionKey: "s1", skillsPrompt: DRIFTED_CATALOG })).toBe(
      FIRST_CATALOG,
    );
  });

  it("pins each session on its own catalog", () => {
    pinSkillsPromptForSession({ sessionKey: "s1", skillsPrompt: FIRST_CATALOG });

    expect(pinSkillsPromptForSession({ sessionKey: "s2", skillsPrompt: DRIFTED_CATALOG })).toBe(
      DRIFTED_CATALOG,
    );
    expect(pinSkillsPromptForSession({ sessionKey: "s1", skillsPrompt: DRIFTED_CATALOG })).toBe(
      FIRST_CATALOG,
    );
  });

  it("warns about drift once per session", () => {
    pinSkillsPromptForSession({ sessionKey: "s1", skillsPrompt: FIRST_CATALOG });

    pinSkillsPromptForSession({ sessionKey: "s1", skillsPrompt: DRIFTED_CATALOG });
    pinSkillsPromptForSession({ sessionKey: "s1", skillsPrompt: DRIFTED_CATALOG });

    expect(warn).toHaveBeenCalledTimes(1);
    // The catalog can embed operator-authored text, so only sizes and digests travel.
    expect(JSON.stringify(warn.mock.calls[0])).not.toContain("runbook");
  });

  it.each([
    { label: "sessionless", sessionKey: undefined, skillsPrompt: FIRST_CATALOG },
    { label: "catalog-less", sessionKey: "s1", skillsPrompt: undefined },
  ])("passes through the $label build unchanged", ({ sessionKey, skillsPrompt }) => {
    expect(pinSkillsPromptForSession({ sessionKey, skillsPrompt })).toBe(skillsPrompt);
    expect(warn).not.toHaveBeenCalled();
  });
});
