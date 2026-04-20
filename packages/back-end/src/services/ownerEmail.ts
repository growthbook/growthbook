import { getUsersByIds } from "back-end/src/models/UserModel";

export { withOwnerEmail } from "./ownerEmailHelpers";

/**
 * Resolves an owner value (userId or email) to an email address.
 *
 * - If `owner` starts with "u_", looks up the user in the DB and returns their email.
 * - If `owner` looks like an email (contains "@"), echoes it back as-is.
 * - Otherwise (display names, empty strings) returns undefined.
 */
export async function resolveUserIdToEmail(
  owner: string | undefined,
): Promise<string | undefined> {
  if (!owner) return undefined;
  if (owner.startsWith("u_")) {
    const users = await getUsersByIds([owner]);
    return users[0]?.email;
  }
  if (owner.includes("@")) {
    return owner;
  }
  return undefined;
}

/**
 * Batch-resolves an array of owner values to a Map<owner, email>.
 * Deduplicates userIds and makes a single DB call.
 */
export async function buildOwnerEmailMap(
  ownerValues: (string | undefined)[],
): Promise<Map<string, string | undefined>> {
  const map = new Map<string, string | undefined>();

  const userIds = [
    ...new Set(
      ownerValues.filter((o): o is string => !!o && o.startsWith("u_")),
    ),
  ];

  const users = userIds.length > 0 ? await getUsersByIds(userIds) : [];
  const userEmailMap = new Map(users.map((u) => [u.id, u.email]));

  for (const owner of ownerValues) {
    if (!owner || map.has(owner)) continue;
    if (owner.startsWith("u_")) {
      map.set(owner, userEmailMap.get(owner));
    } else if (owner.includes("@")) {
      map.set(owner, owner);
    } else {
      map.set(owner, undefined);
    }
  }

  return map;
}
