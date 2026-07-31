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

// Resolves the SDK attribute a userIdType reads its value from. Managed types
// carry an explicit link; user-created types are named after their own source.
export function getEventForwarderUserIdTypeSourceAttribute(
  userIdType: UserIdType,
): string {
  if (isEventForwarderManagedUserIdType(userIdType)) {
    return userIdType.sourceAttribute ?? userIdType.userIdType;
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

/**
 * Reconciles the managed identifier types on a datasource against the ones the
 * org's attribute schema currently calls for, matching on `sourceAttribute` so
 * that user-renamed identifier types keep their names instead of being reverted.
 *
 * Non-managed identifier types are passed through untouched, and one is never
 * promoted to managed — only types this function created are ever dropped again.
 * Managed types whose source attribute is no longer a hash attribute (archived,
 * un-flagged, or out of the datasource's Projects) are dropped.
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

    // Never take over an identifier type we did not create. Adopting one would
    // make a user's own entry deletable by the loop above as soon as its
    // attribute is archived, taking any fact table or identity join that
    // references the name with it. If the name is taken we simply add nothing:
    // the existing entry already models that unit, and the Events fact table
    // still projects a column for it (non-managed types resolve to their own
    // name as the source attribute).
    const nameIsTaken = result.some(
      (entry) =>
        normalizeUserIdTypeName(entry.userIdType) ===
        normalizeUserIdTypeName(wanted.userIdType),
    );
    if (nameIsTaken) {
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
