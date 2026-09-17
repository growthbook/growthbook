import isEqual from "lodash/isEqual";
import omit from "lodash/omit";
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

// Applied only to break a name collision. Nothing reads or strips it.
export const EVENT_FORWARDER_NAME_COLLISION_PREFIX = "ef_";

export function isEventForwarderManaged(record: {
  managedBy?: string;
}): boolean {
  return record.managedBy === "api";
}

export function normalizeUserIdTypeName(userIdType: string): string {
  return userIdType.trim().toLowerCase();
}

export function toNormalizedNameSet(names: string[]): Set<string> {
  return new Set(names.map(normalizeUserIdTypeName));
}

export function resolveEventForwarderManagedName(
  desired: string,
  taken: Set<string>,
): string {
  let name = desired;
  // Every pass lengthens the name, so a free one is reached within taken.size + 1.
  for (let i = 0; i <= taken.size; i++) {
    if (!taken.has(normalizeUserIdTypeName(name))) {
      return name;
    }
    name = `${EVENT_FORWARDER_NAME_COLLISION_PREFIX}${name}`;
  }
  return name;
}

/**
 * The SDK hash attribute an identifier type models: its sole Linked Hash
 * Attribute, or its own name when it has none. An entry linked to several
 * attributes models none of them on its own.
 */
export function getEventForwarderUserIdTypeSourceAttribute(
  userIdType: UserIdType,
): string {
  const attributes = userIdType.attributes ?? [];
  return attributes.length === 1 ? attributes[0] : userIdType.userIdType;
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

/**
 * Rejects an update that removes or edits a record the Event Forwarder manages.
 * The UI hides those actions; this is what makes the lock hold for direct API
 * calls and stale browser tabs.
 */
export function findEventForwarderManagedViolation<
  T extends { managedBy?: string },
>({
  before,
  after,
  identify,
  label,
}: {
  before: T[] | undefined;
  after: T[] | undefined;
  identify: (record: T) => string;
  label: string;
}): string | null {
  if (!before?.length) {
    return null;
  }
  const afterByKey = new Map((after ?? []).map((r) => [identify(r), r]));
  for (const record of before) {
    if (!isEventForwarderManaged(record)) {
      continue;
    }
    const updated = afterByKey.get(identify(record));
    if (!updated) {
      return `Cannot delete ${label} ${identify(record)} because it is managed by Event Forwarder`;
    }
    // `error` is stamped by query validation on the way through, so it is the
    // one field a managed record must be free to change — otherwise a broken
    // managed query can never persist its error and the UI shows nothing.
    if (!isEqual(omit(record, "error"), omit(updated, "error"))) {
      return `Cannot edit ${label} ${identify(record)} because it is managed by Event Forwarder`;
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

export function getEventForwarderHashAttributes(
  attributeSchema: SDKAttributeSchema,
  datasourceProjects?: string[],
): string[] {
  return attributeSchema
    .filter((a) => a.hashAttribute && !a.archived)
    .filter((a) => attributeMatchesDatasourceProjects(a, datasourceProjects))
    .map((a) => a.property);
}

export type EventForwarderUserIdTypePair = {
  attribute: string;
  userIdType: UserIdType;
};

export type EventForwarderUserIdTypeResolution = {
  userIdTypes: UserIdType[];
  pairs: EventForwarderUserIdTypePair[];
};

function findUserIdTypeModelling(
  entries: UserIdType[],
  attribute: string,
  claimed: Set<number>,
): { index: number; needsLink: boolean } {
  const normalized = normalizeUserIdTypeName(attribute);

  const linked = entries.findIndex((entry, i) => {
    const attributes = entry.attributes ?? [];
    return (
      !claimed.has(i) &&
      attributes.length === 1 &&
      normalizeUserIdTypeName(attributes[0]) === normalized
    );
  });
  if (linked >= 0) {
    return { index: linked, needsLink: false };
  }

  const named = entries.findIndex(
    (entry, i) =>
      !claimed.has(i) &&
      (entry.attributes ?? []).length === 0 &&
      normalizeUserIdTypeName(entry.userIdType) === normalized,
  );
  return { index: named, needsLink: named >= 0 };
}

/**
 * Pairs each live hash attribute with the identifier type that models it,
 * creating one where nothing does. Existing names and ids are never rewritten
 * and nothing is ever removed: an entry whose attribute is gone stays exactly as
 * it is, so it resumes updating if that attribute comes back.
 */
export function resolveEventForwarderManagedUserIdTypes(
  existing: UserIdType[],
  attributes: string[],
): EventForwarderUserIdTypeResolution {
  const userIdTypes = existing.map((entry) => ({ ...entry }));
  const takenNames = toNormalizedNameSet(
    userIdTypes.map((entry) => entry.userIdType),
  );
  const claimed = new Set<number>();
  const pairs: EventForwarderUserIdTypePair[] = [];

  for (const attribute of attributes) {
    const { index, needsLink } = findUserIdTypeModelling(
      userIdTypes,
      attribute,
      claimed,
    );

    if (index >= 0) {
      claimed.add(index);
      userIdTypes[index] = {
        ...userIdTypes[index],
        ...(needsLink && { attributes: [attribute] }),
        managedBy: "api",
      };
      pairs.push({ attribute, userIdType: userIdTypes[index] });
      continue;
    }

    const created: UserIdType = {
      userIdType: resolveEventForwarderManagedName(attribute, takenNames),
      description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
      attributes: [attribute],
      managedBy: "api",
    };
    takenNames.add(normalizeUserIdTypeName(created.userIdType));
    claimed.add(userIdTypes.length);
    userIdTypes.push(created);
    pairs.push({ attribute, userIdType: created });
  }

  return { userIdTypes, pairs };
}
