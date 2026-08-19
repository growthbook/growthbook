import {
  DataSourceParams,
  DataSourceType,
  UserIdType,
} from "shared/types/datasource";
import { EventForwarderSinkType } from "shared/types/event-forwarder";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import { SDKAttribute, SDKAttributeSchema } from "shared/types/organization";

export const EVENT_FORWARDER_SUPPORTED_DATASOURCE_TYPES: readonly DataSourceType[] =
  ["bigquery", "snowflake"];

export type EventForwarderDatasourceParams =
  | BigQueryConnectionParams
  | SnowflakeConnectionParams
  | undefined;

export const EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION =
  "Managed by Event Forwarder.";

/**
 * Identifier types the Event Forwarder created. Current ones carry
 * `managedBy: "api"`; ones written before that field existed are recognized by
 * the shape they were always written with — see
 * isLegacyEventForwarderManagedUserIdType.
 */
export function isEventForwarderManagedUserIdType(
  userIdType: UserIdType,
): boolean {
  return (
    userIdType.managedBy === "api" ||
    isLegacyEventForwarderManagedUserIdType(userIdType)
  );
}

/**
 * Identifier types the Event Forwarder feeds warehouse queries for: the ones it
 * created, plus user-created ones already linked to a hash attribute. Linking is
 * not ownership — only `managedBy` entries are ever deleted here.
 */
export function isEventForwarderLinkedUserIdType(
  userIdType: UserIdType,
): boolean {
  return (
    isEventForwarderManagedUserIdType(userIdType) ||
    (userIdType.sourceAttribute ?? null) !== null
  );
}

const LEGACY_EVENT_FORWARDER_MANAGED_NAME_PREFIX = "ef_";

/**
 * Identifier types the Event Forwarder wrote before `managedBy` existed. It only
 * ever emitted `{ userIdType: "ef_<attribute>", attributes: ["<attribute>"] }`,
 * so the name and the linked attribute together identify them. Both are required
 * — a user-created `ef_` name that links something else is left alone.
 */
function isLegacyEventForwarderManagedUserIdType(
  userIdType: UserIdType,
): boolean {
  if (
    !userIdType.userIdType.startsWith(
      LEGACY_EVENT_FORWARDER_MANAGED_NAME_PREFIX,
    )
  ) {
    return false;
  }
  const recovered = normalizeUserIdTypeName(
    resolveLegacyEventForwarderManagedSourceAttribute(userIdType.userIdType),
  );
  return (userIdType.attributes ?? []).some(
    (attribute) => normalizeUserIdTypeName(attribute) === recovered,
  );
}

/**
 * Recovers the attribute of a managed resource written before `sourceAttribute`
 * existed, which encoded it as `ef_<attribute>`. Exactly one prefix was ever
 * applied. Read-only — nothing writes prefixed names any more.
 */
export function resolveLegacyEventForwarderManagedSourceAttribute(
  name: string,
): string {
  return name.startsWith(LEGACY_EVENT_FORWARDER_MANAGED_NAME_PREFIX)
    ? name.slice(LEGACY_EVENT_FORWARDER_MANAGED_NAME_PREFIX.length)
    : name;
}

// Resolves the SDK attribute a userIdType reads its value from. Linked types
// carry an explicit link; everything else is named after its own source.
export function getEventForwarderUserIdTypeSourceAttribute(
  userIdType: UserIdType,
): string {
  const linked = userIdType.sourceAttribute ?? null;
  if (linked !== null) {
    return linked;
  }
  if (isEventForwarderManagedUserIdType(userIdType)) {
    return resolveLegacyEventForwarderManagedSourceAttribute(
      userIdType.userIdType,
    );
  }
  return userIdType.userIdType;
}

// Case-insensitive: identifier type names are compared case-insensitively
// everywhere (warehouse column aliases and the sync paths both fold case), so
// "User_Id" and "user_id" are the same name for collision purposes.
export function normalizeUserIdTypeName(userIdType: string): string {
  return userIdType.trim().toLowerCase();
}

/** Returns the name colliding with `candidate`, or null when it is free. */
export function findCollidingUserIdTypeName(
  userIdTypes: UserIdType[],
  candidate: string,
): string | null {
  const normalized = normalizeUserIdTypeName(candidate);
  const collision = userIdTypes.find(
    (existing) => normalizeUserIdTypeName(existing.userIdType) === normalized,
  );
  return collision?.userIdType ?? null;
}

/** Maps each case-insensitively duplicated name to the colliding entry's name. */
function collectDuplicateUserIdTypeNames(
  userIdTypes: UserIdType[],
): Map<string, string> {
  const seen = new Set<string>();
  const duplicates = new Map<string, string>();
  for (const entry of userIdTypes) {
    const normalized = normalizeUserIdTypeName(entry.userIdType);
    if (seen.has(normalized)) {
      duplicates.set(normalized, entry.userIdType);
    }
    seen.add(normalized);
  }
  return duplicates;
}

/** Returns a name that collides case-insensitively within the list, or null. */
export function findDuplicateUserIdTypeName(
  userIdTypes: UserIdType[],
): string | null {
  const [first] = collectDuplicateUserIdTypeNames(userIdTypes).values();
  return first ?? null;
}

/**
 * Returns a name `updated` collides on that `existing` did not, or null.
 *
 * Collisions already stored are grandfathered. A datasource that predates the
 * uniqueness check would otherwise fail every later save — including the Event
 * Forwarder sync, which runs unattended — until someone fixed it by hand.
 */
export function findNewDuplicateUserIdTypeName(
  existing: UserIdType[],
  updated: UserIdType[],
): string | null {
  const before = collectDuplicateUserIdTypeNames(existing);
  for (const [normalized, name] of collectDuplicateUserIdTypeNames(updated)) {
    if (!before.has(normalized)) {
      return name;
    }
  }
  return null;
}

export function getEventForwarderSinkTypeForDatasource(datasource: {
  type: DataSourceType;
}): EventForwarderSinkType | null {
  switch (datasource.type) {
    case "bigquery":
      return "bigquery";
    case "snowflake":
      return "snowflake";
    case "growthbook_clickhouse":
    case "redshift":
    case "athena":
    case "google_analytics":
    case "postgres":
    case "mysql":
    case "mssql":
    case "clickhouse":
    case "presto":
    case "databricks":
    case "mixpanel":
    case "vertica":
    case "adobe_experience_platform_query_service":
    default:
      return null;
  }
}

export function supportsEventForwarder(
  datasource: { type: DataSourceType } | null | undefined,
): boolean {
  if (!datasource) return false;
  return getEventForwarderSinkTypeForDatasource(datasource) !== null;
}

export function getEventForwarderDatasourceParams(
  datasourceType: DataSourceType,
  params: DataSourceParams | undefined,
): EventForwarderDatasourceParams {
  switch (datasourceType) {
    case "bigquery":
      return params as BigQueryConnectionParams;
    case "snowflake":
      return params as SnowflakeConnectionParams;
    case "growthbook_clickhouse":
    case "redshift":
    case "athena":
    case "google_analytics":
    case "postgres":
    case "mysql":
    case "mssql":
    case "clickhouse":
    case "presto":
    case "databricks":
    case "mixpanel":
    case "vertica":
    case "adobe_experience_platform_query_service":
    default:
      return undefined;
  }
}

export function attributeMatchesDatasourceProjects(
  attribute: SDKAttribute,
  datasourceProjects: string[] | undefined,
): boolean {
  if (datasourceProjects?.length && attribute.projects?.length) {
    return attribute.projects.some((project) =>
      datasourceProjects.includes(project),
    );
  }
  return true;
}

export function buildUserIdTypesFromAttributeSchema(
  attributeSchema: SDKAttributeSchema,
  datasourceProjects?: string[],
): UserIdType[] {
  return attributeSchema
    .filter((a) => a.hashAttribute && !a.archived)
    .filter((a) => attributeMatchesDatasourceProjects(a, datasourceProjects))
    .map((a) => ({
      userIdType: a.property,
      description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
      attributes: [a.property],
      managedBy: "api" as const,
      sourceAttribute: a.property,
    }));
}

export function getUserIdTypesToAdd(
  existing: UserIdType[],
  built: UserIdType[],
): UserIdType[] {
  const existingNames = new Set(
    existing.map((u) => normalizeUserIdTypeName(u.userIdType)),
  );
  // A managed type already covering the attribute counts as present even after a
  // rename, so a renamed identifier is never re-added under its original name.
  const existingSources = new Set(
    existing
      .filter(isEventForwarderManagedUserIdType)
      .map((u) =>
        normalizeUserIdTypeName(getEventForwarderUserIdTypeSourceAttribute(u)),
      ),
  );
  return built.filter(
    (u) =>
      !existingNames.has(normalizeUserIdTypeName(u.userIdType)) &&
      !existingSources.has(
        normalizeUserIdTypeName(getEventForwarderUserIdTypeSourceAttribute(u)),
      ),
  );
}

/**
 * Drops the Event Forwarder link and any claim of ownership, keeping everything
 * else. Reconciliation never deletes an identifier type: whatever the entry is
 * named, experiments, identity joins, and the Events fact table may still be
 * reading it, and the user can delete it themselves once they are sure.
 *
 * `managedBy` is only written when it was `"api"`, so releasing an entry that
 * predates the field is a no-op and repeated syncs write nothing.
 */
function releaseUserIdType(userIdType: UserIdType): UserIdType {
  const released = { ...userIdType };
  delete released.sourceAttribute;
  if (released.managedBy === "api") {
    released.managedBy = "";
  }
  return released;
}

/**
 * Reconciles managed identifier types against the hash attributes the org's
 * schema calls for. One identifier type per hash attribute.
 *
 * - Covered attribute → leave the entry alone. Only `sourceAttribute` is
 *   backfilled; the name stays put, and so does every warehouse artifact keyed
 *   off it (column aliases, identity joins, fact table `userIdTypes`).
 * - Uncovered attribute whose name is already taken → link that entry to it,
 *   without claiming ownership.
 * - Uncovered attribute with a free name → add it.
 * - Entry whose attribute is gone (archived, un-flagged, out of the
 *   datasource's Projects) → release it: the link and the managed marker come
 *   off and the entry stays, now the user's to keep or delete.
 */
export function reconcileEventForwarderManagedUserIdTypes(
  existing: UserIdType[],
  desired: UserIdType[],
): UserIdType[] {
  const desiredBySource = new Map(
    desired.map((entry) => [
      normalizeUserIdTypeName(
        getEventForwarderUserIdTypeSourceAttribute(entry),
      ),
      entry,
    ]),
  );
  const claimedSources = new Set<string>();
  const result: UserIdType[] = [];

  for (const entry of existing) {
    const source = normalizeUserIdTypeName(
      getEventForwarderUserIdTypeSourceAttribute(entry),
    );
    const wanted = desiredBySource.get(source);

    if (isEventForwarderManagedUserIdType(entry)) {
      // Attribute gone, or an earlier entry already represents it. The second
      // case only arises from data written before legacy detection worked.
      // Either way the entry is released, never deleted.
      if (!wanted || claimedSources.has(source)) {
        result.push(releaseUserIdType(entry));
        continue;
      }
      claimedSources.add(source);
      // Backfill the markers on legacy entries. Never touch the name.
      result.push({
        ...entry,
        managedBy: "api",
        sourceAttribute:
          entry.sourceAttribute ?? wanted.sourceAttribute ?? source,
      });
      continue;
    }

    // A linked entry claims its attribute so we never add a second type for
    // it. If the attribute is gone the link comes off and the entry stays.
    if ((entry.sourceAttribute ?? null) !== null) {
      if (!wanted) {
        result.push(releaseUserIdType(entry));
        continue;
      }
      claimedSources.add(source);
    }
    result.push(entry);
  }

  for (const [source, wanted] of desiredBySource) {
    if (claimedSources.has(source)) {
      continue;
    }

    // Name already taken: that entry already models this attribute, so link it
    // rather than duplicate it. `managedBy` is deliberately left alone — linking
    // must not make the user's own entry deletable when the attribute is
    // archived, which would take any fact table or identity join with it.
    const reuseIndex = result.findIndex(
      (entry) =>
        normalizeUserIdTypeName(entry.userIdType) ===
        normalizeUserIdTypeName(wanted.userIdType),
    );
    if (reuseIndex >= 0) {
      const reused = result[reuseIndex];
      const sourceAttribute = wanted.sourceAttribute ?? wanted.userIdType;
      const hasSourceAttribute = reused.attributes?.some(
        (attribute) =>
          normalizeUserIdTypeName(attribute) ===
          normalizeUserIdTypeName(sourceAttribute),
      );

      result[reuseIndex] = {
        ...reused,
        sourceAttribute,
        attributes: hasSourceAttribute
          ? reused.attributes
          : [...(reused.attributes ?? []), sourceAttribute],
      };
      continue;
    }

    result.push(wanted);
  }

  return result;
}

export function mergeUserIdTypes(
  existing: UserIdType[],
  built: UserIdType[],
): UserIdType[] {
  const toAdd = getUserIdTypesToAdd(existing, built);
  if (toAdd.length === 0) {
    return existing;
  }
  return [...existing, ...toAdd];
}
