import { EventUser } from "shared/types/events/event-types";
import { revisionActor, revisionActors } from "shared/validators";

// An org key that armed deferred work for a requester is stored as
// `<keyId>:<memberId>`, so the work later runs with that request's permissions.
const ARMING_REQUESTER_SEPARATOR = ":";

export function encodeArmingApiKeyId(
  apiKeyId: string,
  requesterId: string | undefined,
): string {
  return requesterId
    ? `${apiKeyId}${ARMING_REQUESTER_SEPARATOR}${requesterId}`
    : apiKeyId;
}

export function decodeArmingApiKeyId(id: string): {
  apiKeyId: string;
  requesterId: string | null;
} {
  const [apiKeyId, requesterId] = id.split(ARMING_REQUESTER_SEPARATOR, 2);
  return { apiKeyId, requesterId: requesterId || null };
}

// The self-hosted env-var key has no document; the middleware synthesizes one.
export const SECRET_API_KEY_ID = "SECRET_API_KEY";

// An org API key id that can be recorded as an armer and resolved later.
export function isArmingApiKeyId(id: string | undefined): id is string {
  if (!id) return false;
  const { apiKeyId } = decodeArmingApiKeyId(id);
  return apiKeyId.startsWith("key_") || apiKeyId === SECRET_API_KEY_ID;
}

// The stored actor that armed deferred work, from the revision's own actors.
// A key that left none there is named by its ID.
export function armerActor(
  revision: Parameters<typeof revisionActor>[0],
  armerId: string,
): EventUser {
  if (!isArmingApiKeyId(armerId)) return revisionActor(revision, armerId);
  const { apiKeyId, requesterId } = decodeArmingApiKeyId(armerId);
  const found = revisionActors(revision).find(
    (a) =>
      a.type === "api_key" &&
      a.apiKey === apiKeyId &&
      (requesterId
        ? !!a.assumedRole && a.requestedBy?.id === requesterId
        : !a.assumedRole),
  );
  return (
    found ?? {
      type: "api_key",
      apiKey: apiKeyId,
      ...(requesterId && {
        requestedBy: { id: requesterId, name: "", email: "" },
        assumedRole: true,
      }),
    }
  );
}
