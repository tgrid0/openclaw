// Default watchdog timing bounds for CLI-backed agent sessions.
export const CLI_WATCHDOG_MIN_TIMEOUT_MS = 1_000;

export const CLI_FRESH_WATCHDOG_DEFAULTS = {
  noOutputTimeoutRatio: 0.8,
  minMs: 10800 * 1000,
  maxMs: 10800 * 1000,
} as const;

export const CLI_RESUME_WATCHDOG_DEFAULTS = {
  noOutputTimeoutRatio: 0.3,
  minMs: 10800 * 1000,
  maxMs: 10800 * 1000,
} as const;
