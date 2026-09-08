import { createPersistedEphemeralId } from "../utils/persisted-id";

export const SESSION_REPLAY_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

// Idle-refreshed: every read pushes the expiry out, so the replay id only
// rotates after the user has been inactive for the full timeout.
const sessionReplayId = createPersistedEphemeralId({
  storageKey: "gb_session_replay_id",
  idField: "session_replay_id",
  legacyIdFields: ["id"],
  timestampField: "lastTouchedAt",
  expiry: "idle",
  durationMs: SESSION_REPLAY_IDLE_TIMEOUT_MS,
});

export function getOrCreateSessionReplayId(forceNew = false): string {
  return sessionReplayId.getOrCreate({ forceNew });
}
