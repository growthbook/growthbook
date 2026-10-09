import type {
  Attributes,
  RemoteSavedGroup,
  SavedGroupResolver,
  SavedGroupsPayload,
} from "./types/growthbook";

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

/** The payload's remote saved groups. */
export function getRemoteSavedGroups(
  savedGroups: SavedGroupsPayload = {},
): RemoteSavedGroup[] {
  let groups = remoteGroupsByPayload.get(savedGroups);
  if (!groups) {
    groups = Object.keys(savedGroups).reduce<RemoteSavedGroup[]>(
      (remote, id) => {
        const entry = savedGroups[id];
        return !Array.isArray(entry) && entry.type === "remote"
          ? remote.concat({ id, attributeKey: entry.attributeKey })
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
 */
export async function resolveRemoteGroupIds(
  attributes: Attributes,
  savedGroups: SavedGroupsPayload | undefined,
  resolver: SavedGroupResolver,
): Promise<string[]> {
  const groups = getRemoteSavedGroups(savedGroups);
  if (!groups.length) return [];
  return resolver({
    attributes: groups.reduce<Attributes>(
      (used, { attributeKey }) =>
        attributeKey in attributes
          ? { ...used, [attributeKey]: attributes[attributeKey] }
          : used,
      {},
    ),
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
 */
export function redisResolver(redis: RedisSetClient): SavedGroupResolver {
  return async ({ attributes, groups }) => {
    const keys = unique(groups.map((g) => g.attributeKey)).reduce<string[]>(
      (all, attribute) =>
        all.concat(
          toLookupValues(attributes[attribute]).map(
            (value) => `gb:member:${attribute}:${value}`,
          ),
        ),
      [],
    );
    const members = await Promise.all(keys.map((k) => redis.sMembers(k)));
    const wanted = groups.map((g) => g.id);
    return unique(
      ([] as string[])
        .concat(...members)
        .filter((id) => wanted.indexOf(id) !== -1),
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
