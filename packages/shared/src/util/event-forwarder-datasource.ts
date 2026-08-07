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

// Event Forwarder managed identifier types are named after the SDK hash
// attribute they read, and the link to that attribute is stored explicitly on
// `sourceAttribute`. Nothing is encoded in the name: users may rename a managed
// identifier type, and every consumer (SQL generation, reconciliation, fact
// table metadata) resolves the source attribute through the link instead.
export function isEventForwarderManagedUserIdType(
  userIdType: Pick<UserIdType, "managedBy">,
): boolean {
  return userIdType.managedBy === "api";
}

/**
 * Identifier types the Event Forwarder feeds warehouse queries for: the ones it
 * created, plus user-created ones it reuses because they already model the same
 * hash attribute. Reuse links but does not take ownership — only `managedBy`
 * entries are ever deleted by reconciliation.
 */
export function isEventForwarderLinkedUserIdType(
  userIdType: UserIdType,
): boolean {
  return (
    isEventForwarderManagedUserIdType(userIdType) ||
    (userIdType.sourceAttribute ?? null) !== null
  );
}

// Managed resources created before `sourceAttribute` existed encoded the link in
// their name by prefixing the attribute with "ef_". Exactly one prefix was ever
// applied, so stripping one recovers the attribute.
const LEGACY_EVENT_FORWARDER_MANAGED_NAME_PREFIX = "ef_";

/**
 * Recovers the source attribute of a managed resource written before the
 * explicit link existed. Read-only compatibility: nothing writes prefixed names
 * any more, and this is the only place the prefix is still understood. Without
 * it, reconciliation would fail to match a legacy record to its attribute, drop
 * it, and mint a replacement under a new id — orphaning every experiment,
 * report, safe rollout, template, and ramp schedule already referencing the old
 * one. Only ever applied to `managedBy: "api"` resources with no
 * `sourceAttribute`, so a user-created `ef_`-named identifier type is untouched.
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

/** Returns a name that collides case-insensitively within the list, or null. */
export function findDuplicateUserIdTypeName(
  userIdTypes: UserIdType[],
): string | null {
  const seen = new Map<string, string>();
  for (const entry of userIdTypes) {
    const normalized = normalizeUserIdTypeName(entry.userIdType);
    const existing = seen.get(normalized);
    if (existing !== undefined) {
      return entry.userIdType;
    }
    seen.set(normalized, entry.userIdType);
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

/** Drops the Event Forwarder link from a reused identifier type, keeping the rest. */
function unlinkUserIdType(userIdType: UserIdType): UserIdType {
  return {
    userIdType: userIdType.userIdType,
    description: userIdType.description,
    attributes: userIdType.attributes,
    managedBy: userIdType.managedBy,
  };
}

/**
 * Reconciles the managed identifier types on a datasource against the ones the
 * org's attribute schema currently calls for, matching on `sourceAttribute` so
 * that user-renamed identifier types keep their names instead of being reverted.
 *
 * Non-managed identifier types are passed through untouched, and one is never
 * promoted to managed — only types this function created are ever dropped again.
 * Managed types whose source attribute is no longer a hash attribute (archived,
 * un-flagged, or out of the datasource's Projects) are dropped.
 *
 * Does not rewrite `queries.identityJoins[].ids` when an identifier type is
 * renamed outside this path (e.g. direct MongoDB edit).
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
    if (!isEventForwarderManagedUserIdType(entry)) {
      // A reused entry is the user's, so it is never dropped — but it still
      // claims its attribute so we don't create a second identifier type for the
      // same one, and it keeps its link across a rename. If the attribute is no
      // longer eligible we unlink instead, which stops us feeding it queries.
      if (isEventForwarderLinkedUserIdType(entry)) {
        const reusedSource = normalizeUserIdTypeName(
          getEventForwarderUserIdTypeSourceAttribute(entry),
        );
        if (desiredBySource.has(reusedSource)) {
          claimedSources.add(reusedSource);
        } else {
          result.push(unlinkUserIdType(entry));
          continue;
        }
      }
      result.push(entry);
      continue;
    }

    const source = normalizeUserIdTypeName(
      getEventForwarderUserIdTypeSourceAttribute(entry),
    );
    const wanted = desiredBySource.get(source);
    if (!wanted) {
      continue;
    }

    claimedSources.add(source);
    // The name and description belong to the user once created; we only keep the
    // link and the managed marker authoritative.
    result.push({
      ...entry,
      managedBy: "api",
      sourceAttribute: wanted.sourceAttribute,
    });
  }

  for (const [source, wanted] of desiredBySource) {
    if (claimedSources.has(source)) {
      continue;
    }

    // Reuse, don't duplicate or take over. When a user already has an identifier
    // type under this name it already models the same unit, so link it to the
    // attribute and backfill the hash attribute and description if they are not
    // set yet. `managedBy` is deliberately left alone: reuse must not make the
    // user's own entry deletable by the loop above once the attribute is
    // archived, which would take any fact table or identity join referencing the
    // name with it.
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
        description: reused.description || wanted.description,
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
