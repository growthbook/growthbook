import { createPersistedEphemeralId } from "./persisted-id";

export const DEFAULT_MAX_DURATION_MS = 10 * 60 * 1000;

// Hard time cap from creation: the session id rotates maxDuration after it
// was minted, regardless of activity.
const gbSession = createPersistedEphemeralId({
  storageKey: "gb_session",
  idField: "gbSessionId",
  timestampField: "createdAt",
  expiry: "fixed",
  durationMs: DEFAULT_MAX_DURATION_MS,
});

export function getOrCreateGbSessionId(options?: {
  forceNew?: boolean;
  maxDuration?: number;
}): string {
  return gbSession.getOrCreate({
    forceNew: options?.forceNew,
    durationMs: options?.maxDuration,
  });
}
