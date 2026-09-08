import { createPersistedEphemeralId } from "../utils/persisted-id";

export const SESSION_REPLAY_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

// Tab-scoped (sessionStorage) by design: a recording captures one DOM, so
// each tab gets its own replay id. Correlation across tabs and to other
// event streams happens via the shared sessionId attribute, not this one.
// Idle-refreshed: every read pushes the expiry out, so the replay id only
// rotates after the user has been inactive for the full timeout.
const sessionReplayId = createPersistedEphemeralId({
  key: "gb_session_replay_id",
  idleTimeoutMs: SESSION_REPLAY_IDLE_TIMEOUT_MS,
});

export function getOrCreateSessionReplayId(forceNew = false): string {
  return sessionReplayId.getOrCreate({ forceNew });
}

export function _resetSessionReplayIdForTests(): void {
  sessionReplayId.reset();
}
