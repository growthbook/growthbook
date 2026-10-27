import type {
  Attributes,
  RemoteSavedGroup,
  SavedGroupResolver,
  SavedGroupsPayload,
} from "./types/growthbook";
import { getPath } from "./util";

/**
 * The attribute evaluation reads a user's remote saved groups from. Internal
 * attributes start with `__gb_`, matching GrowthBook's back end.
 */
export const REMOTE_GROUP_IDS_ATTRIBUTE = "__gb_remoteGroupIds";

// Evaluation checks for remote groups often, so each payload is scanned once.
const remoteGroupsByPayload = new WeakMap<
  SavedGroupsPayload,
  RemoteSavedGroup[]
>();

const NO_REMOTE_GROUPS: RemoteSavedGroup[] = [];

/** Only v2 payloads include the remote group metadata this helper reads. */
export function getRemoteSavedGroups(
  savedGroups?: SavedGroupsPayload,
): RemoteSavedGroup[] {
  // Most payloads have no saved groups; skip the allocation on the hot path
  if (!savedGroups) return NO_REMOTE_GROUPS;
  let groups = remoteGroupsByPayload.get(savedGroups);
  if (!groups) {
    groups = Object.keys(savedGroups).reduce<RemoteSavedGroup[]>(
      (remote, id) => {
        const entry = savedGroups[id];
        return !Array.isArray(entry) && entry.type === "remote"
          ? remote.concat({
              id,
              attributeKey: entry.attributeKey,
              ...(entry.valuesFrom && { valuesFrom: entry.valuesFrom }),
            })
          : remote;
      },
      [],
    );
    remoteGroupsByPayload.set(savedGroups, groups);
  }
  return groups;
}

/**
 * Asks `resolver` which of the payload's remote groups the user is in. Only
 * the attributes those groups use are passed. Throws what the resolver
 * throws.
 *
 * Returns [] when the payload lists no remote groups. Don't set that as
 * `__gb_remoteGroupIds`: the payload may still check it directly, and [] makes
 * "not in group" rules match. Check `getRemoteSavedGroups` first.
 */
export async function resolveRemoteGroupIds(
  attributes: Attributes,
  savedGroups: SavedGroupsPayload | undefined,
  resolver: SavedGroupResolver,
): Promise<string[]> {
  const groups = getRemoteSavedGroups(savedGroups);
  if (!groups.length) return [];
  return resolver({
    // Keyed by `attributeKey`, which can be a dot-separated path.
    attributes: groups.reduce<Attributes>((used, { attributeKey }) => {
      const value = getPath(attributes, attributeKey);
      return value === null ? used : { ...used, [attributeKey]: value };
    }, {}),
    groups,
  });
}

/** A Redis client with the one command `redisResolver` needs. */
export type RedisSetClient = {
  sMembers(key: string): Promise<string[]>;
};

/**
 * A resolver for remote groups loaded into Redis by GrowthBook's loader: one
 * `SMEMBERS gb:member:<attribute>:<value>` per attribute value. Works with a
 * node-redis v4 client; wrap others, e.g. `{ sMembers: (k) => redis.smembers(k) }`.
 *
 * A derived group checks its own attribute's value in its source group's
 * sets: `grp_vip:parent_id` looks up `gb:member:<grp_vip's attribute>:<parent_id>`
 * and matches when `grp_vip` comes back.
 */
export function redisResolver(redis: RedisSetClient): SavedGroupResolver {
  return async ({ attributes, groups }) => {
    // For each group and value: the Redis key, and the ID that means a match
    const checks = groups.reduce<
      { id: string; key: string; matchId: string }[]
    >((all, group) => {
      const source = group.valuesFrom
        ? groups.find((g) => g.id === group.valuesFrom)
        : group;
      if (!source) return all;
      return all.concat(
        toLookupValues(attributes[group.attributeKey]).map((value) => ({
          id: group.id,
          key: `gb:member:${source.attributeKey}:${value}`,
          matchId: source.id,
        })),
      );
    }, []);
    const keys = unique(checks.map((c) => c.key));
    const members = await Promise.all(keys.map((k) => redis.sMembers(k)));
    // Checking for the expected ID, not any ID in the set, also keeps keys
    // that collide when attributes or values contain ":" (`a:b` + `c` and
    // `a` + `b:c`) from mixing up groups.
    return unique(
      checks
        .filter((c) => members[keys.indexOf(c.key)].indexOf(c.matchId) !== -1)
        .map((c) => c.id),
    );
  };
}

function unique(values: string[]): string[] {
  return values.filter((value, i) => values.indexOf(value) === i);
}

// Each item of an array is looked up. Numbers use `String(value)`, the same
// form the loader stores them in.
function toLookupValues(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value])
    .filter(
      (v) =>
        typeof v === "string" || (typeof v === "number" && Number.isFinite(v)),
    )
    .map(String);
}

/**
 * Whether the payload has remote groups but the user has no remote group IDs,
 * so every rule using them will fail.
 */
export function isMissingRemoteGroupIds(
  user: { attributes?: Attributes; remoteGroupIds?: string[] },
  savedGroups: SavedGroupsPayload | undefined,
): boolean {
  return (
    !user.remoteGroupIds &&
    !Array.isArray(user.attributes?.[REMOTE_GROUP_IDS_ATTRIBUTE]) &&
    getRemoteSavedGroups(savedGroups).length > 0
  );
}
