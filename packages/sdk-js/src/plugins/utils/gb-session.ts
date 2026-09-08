import { createPersistedEphemeralId } from "./persisted-id";
import { getLocalStorage } from "./storage";

export const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_DURATION_MS = 60 * 60 * 1000;

// Cross-tab activity session (APM-style): localStorage-backed so one sitting
// spans tabs and reloads. Rotates after idleTimeout of inactivity (each read
// refreshes the window), with maxDuration as a hard cap from creation.
const gbSession = createPersistedEphemeralId({
  key: "gb_session_id",
  idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
  maxDurationMs: DEFAULT_MAX_DURATION_MS,
  storage: getLocalStorage,
});

export function getOrCreateGbSessionId(options?: {
  forceNew?: boolean;
  idleTimeout?: number;
  maxDuration?: number;
}): string {
  return gbSession.getOrCreate({
    forceNew: options?.forceNew,
    idleTimeoutMs: options?.idleTimeout,
    maxDurationMs: options?.maxDuration,
  });
}

export function _resetGbSessionForTests(): void {
  gbSession.reset();
}
