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
export const EVENT_FORWARDER_RELEASED_DESCRIPTION = "Managed by User";

export function isEventForwarderManagedUserIdType(
  userIdType: UserIdType,
): boolean {
  return userIdType.managedBy === "api";
}

export function isEventForwarderLinkedUserIdType(
  userIdType: UserIdType,
): boolean {
  return (
    isEventForwarderManagedUserIdType(userIdType) ||
    (userIdType.sourceAttribute ?? null) !== null
  );
}

// Explicit link, else sole Linked Hash Attribute, else name.
export function getEventForwarderUserIdTypeSourceAttribute(
  userIdType: UserIdType,
): string {
  const linked = userIdType.sourceAttribute ?? null;
  if (linked !== null) {
    return linked;
  }
  const attributes = userIdType.attributes ?? [];
  if (attributes.length === 1) {
    return attributes[0];
  }
  return userIdType.userIdType;
}

export function normalizeUserIdTypeName(userIdType: string): string {
  return userIdType.trim().toLowerCase();
}

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

export function findDuplicateUserIdTypeName(
  userIdTypes: UserIdType[],
): string | null {
  const [first] = collectDuplicateUserIdTypeNames(userIdTypes).values();
  return first ?? null;
}

// Grandfather pre-existing collisions so unattended syncs still save.
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
  const existingSources = new Set(
    existing.map((u) =>
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

export function releaseEventForwarderManagedDescription(
  description: string,
  managedDescription: string,
): string;
export function releaseEventForwarderManagedDescription(
  description: string | undefined,
  managedDescription: string,
): string | undefined;
export function releaseEventForwarderManagedDescription(
  description: string | undefined,
  managedDescription: string,
): string | undefined {
  return description === managedDescription
    ? EVENT_FORWARDER_RELEASED_DESCRIPTION
    : description;
}

export function releaseEventForwarderManagedRecord<
  T extends {
    managedBy?: string;
    sourceAttribute?: string;
    description?: string;
  },
>(record: T, managedDescription: string): T {
  const released = { ...record };
  if (released.managedBy === "api") {
    released.managedBy = "";
  }
  delete released.sourceAttribute;
  released.description = releaseEventForwarderManagedDescription(
    released.description,
    managedDescription,
  );
  return released;
}

export function reconcileEventForwarderManagedUserIdTypes(
  existing: UserIdType[],
  desired: UserIdType[],
): UserIdType[] {
  const desiredBySource = new Map<string, UserIdType>();
  for (const entry of desired) {
    const source = normalizeUserIdTypeName(
      getEventForwarderUserIdTypeSourceAttribute(entry),
    );
    if (!desiredBySource.has(source)) {
      desiredBySource.set(source, entry);
    }
  }

  const claimedSources = new Set<string>();
  const result: UserIdType[] = [];

  // Claim explicit sourceAttribute links first.
  for (const entry of existing) {
    if ((entry.sourceAttribute ?? null) === null) {
      result.push(entry);
      continue;
    }
    const source = normalizeUserIdTypeName(entry.sourceAttribute as string);
    if (!desiredBySource.has(source) || claimedSources.has(source)) {
      result.push(
        releaseEventForwarderManagedRecord(
          entry,
          EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
        ),
      );
      continue;
    }
    claimedSources.add(source);
    result.push(entry);
  }

  for (const [source, wanted] of desiredBySource) {
    if (claimedSources.has(source)) {
      continue;
    }

    const sourceAttribute = wanted.sourceAttribute ?? wanted.userIdType;
    const isUnlinked = (entry: UserIdType) =>
      (entry.sourceAttribute ?? null) === null;
    // Prefer attributes[] match over name match.
    const hostIndex = (() => {
      const byAttribute = result.findIndex(
        (entry) =>
          isUnlinked(entry) &&
          (entry.attributes ?? []).some(
            (attribute) => normalizeUserIdTypeName(attribute) === source,
          ),
      );
      if (byAttribute >= 0) {
        return byAttribute;
      }
      return result.findIndex(
        (entry) =>
          isUnlinked(entry) &&
          normalizeUserIdTypeName(entry.userIdType) === source,
      );
    })();

    if (hostIndex >= 0) {
      const host = result[hostIndex];
      const hasSourceAttribute = (host.attributes ?? []).some(
        (attribute) => normalizeUserIdTypeName(attribute) === source,
      );
      result[hostIndex] = {
        ...host,
        sourceAttribute,
        attributes: hasSourceAttribute
          ? host.attributes
          : [...(host.attributes ?? []), sourceAttribute],
      };
      claimedSources.add(source);
      continue;
    }

    result.push(wanted);
    claimedSources.add(source);
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
