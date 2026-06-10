import { ApiEventUser, EventUser } from "shared/validators";

// API-safe projection of the internal EventUser union. Deliberately never
// exposes the api_key actor's `apiKey` field — only stable identifying fields.
export function eventUserToApiEventUser(
  user: EventUser | undefined,
): ApiEventUser | undefined {
  if (!user) return undefined;
  switch (user.type) {
    case "dashboard":
      return {
        type: "dashboard",
        id: user.id,
        name: user.name,
        email: user.email,
      };
    case "api_key":
      return {
        type: "api_key",
        id: user.id,
        name: user.name,
        email: user.email,
      };
    case "system":
      return {
        type: "system",
        id: user.id,
      };
  }
  // Fail closed for legacy stored documents with an unrecognized type.
  return undefined;
}

// Best-effort projection of a legacy revision `authorId` (stored before the
// structured `author` field existed) into an ApiEventUser. `usersById` is an
// optional pre-batched lookup of org users keyed by user id. Legacy revisions
// created via user-scoped API keys stored only the user's id, so they surface
// as type "dashboard" — a known approximation for pre-existing documents.
// Backfilled baseline revisions (see ensureLiveRevisionExists) stored the
// entity's `owner`, which may be an email or a free-form display name.
export function legacyUserIdToApiEventUser(
  userId: string | undefined,
  usersById?: Map<string, { name?: string; email?: string }>,
): ApiEventUser | undefined {
  // Org-scoped API keys have no userId, so drafts they created stored "".
  if (!userId) return undefined;
  if (userId.startsWith("u_")) {
    const user = usersById?.get(userId);
    return {
      type: "dashboard",
      id: userId,
      ...(user?.name ? { name: user.name } : {}),
      ...(user?.email ? { email: user.email } : {}),
    };
  }
  if (userId.includes("@")) return { type: "dashboard", email: userId };
  return { type: "dashboard", name: userId };
}
