import { createPersistedEphemeralId } from "../utils/persisted-id";

export const SESSION_REPLAY_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

// Tab-scoped by design — a recording captures one DOM. Cross-tab/stream
// correlation happens via the shared sessionId attribute, not this id.
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
