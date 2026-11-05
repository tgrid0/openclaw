import { describe, expect, it } from "vitest";
import type { CronJob } from "../types.js";
import { resolveCronJobTimeoutMs } from "./timeout-policy.js";

function makeJob(payload: CronJob["payload"]): CronJob {
  const sessionTarget = payload.kind === "agentTurn" ? "isolated" : "main";
  return {
    id: "job-1",
    name: "job",
    createdAtMs: 0,
    updatedAtMs: 0,
    enabled: true,
    schedule: { kind: "every", everyMs: 60_000 },
    sessionTarget,
    wakeMode: "next-heartbeat",
    payload,
    state: {},
  };
}

describe("timeout-policy", () => {
  it.each([
    { timeoutSeconds: undefined, expected: 36_000_000 },
    { timeoutSeconds: 0, expected: undefined },
  ])("resolves agent timeoutSeconds=$timeoutSeconds", ({ timeoutSeconds, expected }) => {
    const timeout = resolveCronJobTimeoutMs(
      makeJob({ kind: "agentTurn", message: "hi", timeoutSeconds }),
    );
    expect(timeout).toBe(expected);
  });
});
