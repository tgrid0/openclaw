import { describe, expect, it, vi } from "vitest";
import { buildSystemPrompt } from "./system-prompt.js";

describe("buildSystemPrompt", () => {
  it.each([
    { name: "default", customPrompt: undefined },
    { name: "custom", customPrompt: "Custom replacement prompt" },
  ])("keeps the $name prompt unchanged across local day rollover", ({ customPrompt }) => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-27T12:00:00.000Z"));
      const beforeMidnight = buildSystemPrompt({ cwd: "/tmp/workspace", customPrompt });
      vi.setSystemTime(new Date("2026-09-28T12:00:00.000Z"));
      const afterMidnight = buildSystemPrompt({ cwd: "/tmp/workspace", customPrompt });

      expect(afterMidnight).toBe(beforeMidnight);
      expect(afterMidnight).toContain("Current working directory: /tmp/workspace");
    } finally {
      vi.useRealTimers();
    }
  });

  it("includes promised-work policy in the default prompt only", () => {
    const prompt = buildSystemPrompt({ cwd: "/tmp/workspace" });

    expect(prompt).toContain("## Promised Work");
    expect(prompt).toContain("Progress such as `running` is not completion.");
    expect(prompt.match(/## Promised Work/g)).toHaveLength(1);

    expect(
      buildSystemPrompt({
        cwd: "/tmp/workspace",
        customPrompt: "Custom replacement prompt",
      }),
    ).not.toContain("## Promised Work");
  });
});
