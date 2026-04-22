import { ReqContext } from "back-end/types/request";

/**
 * Resolves an owner input value (userId or email address) to a userId.
 *
 * - If `ownerInput` is empty/undefined, returns `undefined` (caller decides the fallback).
 * - If `ownerInput` looks like a userId (starts with "u_"), validates org membership and returns it.
 * - Otherwise treats `ownerInput` as an email and looks up the matching org member:
 *   - If found, returns their userId.
 *   - If not found and `strict` is true, throws an error.
 *   - If not found and `strict` is false (default), returns the original input unchanged
 *     so existing API workflows that store display names or emails are not broken.
 */
export async function resolveOwnerToUserId(
  ownerInput: string | undefined,
  context: ReqContext,
  { strict = false }: { strict?: boolean } = {},
): Promise<string | undefined> {
  if (!ownerInput) return undefined;

  // Explicit userId — must be a valid org member.
  if (ownerInput.startsWith("u_")) {
    if (!context.org.members.some((m) => m.id === ownerInput)) {
      throw new Error(`Unable to find user: ${ownerInput}`);
    }
    return ownerInput;
  }

  // Email — resolve to userId if possible.
  const user = await context.getUserByEmail(ownerInput);
  if (user && context.org.members.some((m) => m.id === user.id)) {
    return user.id;
  }
  if (strict) {
    throw new Error(`Unable to find user: ${ownerInput}`);
  }
  // Non-strict: leave legacy display names / unresolvable emails unchanged.
  return ownerInput;
}

// In-memory userId → email cache. Safe to key by userId alone because
// UserModel ids are globally unique (users live outside any single org).
// Stale for up to TTL when a user changes their email — same trade-off
// as expandedMemberInfoCache in services/organizations.
const USER_EMAIL_CACHE_TTL_MS = 15 * 60 * 1000;
const userEmailCache = new Map<string, { email: string; expiresAt: number }>();

function getCachedEmail(userId: string, now: number): string | undefined {
  const entry = userEmailCache.get(userId);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    userEmailCache.delete(userId);
    return undefined;
  }
  return entry.email;
}

function setCachedEmail(userId: string, email: string, now: number): void {
  // Random jitter to avoid synchronized cache expiry across entries.
  const jitter = Math.floor(Math.random() * USER_EMAIL_CACHE_TTL_MS * 0.1);
  userEmailCache.set(userId, {
    email,
    expiresAt: now + USER_EMAIL_CACHE_TTL_MS + jitter,
  });
}

// Exposed for tests — resets the module-level cache between cases.
export function clearOwnerEmailCache(): void {
  userEmailCache.clear();
}

/**
 * Batch-resolves an array of owner values to a Map<owner, email>.
 * Deduplicates userIds, checks the in-memory cache, and only hits the DB
 * for the remaining cache misses.
 */
async function buildOwnerEmailMap(
  ownerValues: (string | undefined)[],
  context: ReqContext,
): Promise<Map<string, string | undefined>> {
  const now = Date.now();
  const map = new Map<string, string | undefined>();

  const userIds = [
    ...new Set(
      ownerValues.filter((o): o is string => !!o && o.startsWith("u_")),
    ),
  ];

  const userEmailMap = new Map<string, string>();
  const missingIds: string[] = [];
  for (const id of userIds) {
    const cached = getCachedEmail(id, now);
    if (cached !== undefined) {
      userEmailMap.set(id, cached);
    } else {
      missingIds.push(id);
    }
  }

  if (missingIds.length > 0) {
    const users = await context.getUsersByIds(missingIds);
    for (const u of users) {
      userEmailMap.set(u.id, u.email);
      setCachedEmail(u.id, u.email, now);
    }
  }

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

function withOwnerEmail<T extends object>(
  apiDoc: T,
  map: Map<string, string | undefined> | undefined,
): T {
  if (!map) return apiDoc;
  if (!("owner" in apiDoc) || typeof apiDoc.owner !== "string") return apiDoc;
  const email = map.get(apiDoc.owner);
  if (email === undefined) return apiDoc;
  return { ...apiDoc, ownerEmail: email };
}

/**
 * Attaches a resolved `ownerEmail` to a single API doc.
 *
 * - If the doc has no string `owner` field, it is returned unchanged.
 * - If the `owner` cannot be resolved to an email (e.g. a legacy display name
 *   or a userId no longer in the DB), the doc is returned unchanged.
 * - Otherwise a shallow copy of the doc is returned with `ownerEmail` set.
 *
 * For lists of docs, prefer `resolveOwnerEmails` so the DB lookup is batched.
 */
export async function resolveOwnerEmail<T extends object>(
  apiDoc: T,
  context: ReqContext,
): Promise<T> {
  if (!("owner" in apiDoc) || typeof apiDoc.owner !== "string") return apiDoc;
  const map = await buildOwnerEmailMap([apiDoc.owner], context);
  return withOwnerEmail(apiDoc, map);
}

/**
 * Attaches a resolved `ownerEmail` to each API doc in a list.
 *
 * All owners are resolved in a single batched, deduplicated DB lookup with
 * an in-memory cache. Docs without an `owner`, or whose owner cannot be
 * resolved, are returned unchanged. Other docs are shallow-copied with
 * `ownerEmail` set.
 */
export async function resolveOwnerEmails<T extends object>(
  apiDocs: T[],
  context: ReqContext,
): Promise<T[]> {
  if (apiDocs.length === 0) return apiDocs;
  const ownerValues = apiDocs.map((d) =>
    "owner" in d && typeof d.owner === "string" ? d.owner : undefined,
  );
  const map = await buildOwnerEmailMap(ownerValues, context);
  return apiDocs.map((d) => withOwnerEmail(d, map));
}
