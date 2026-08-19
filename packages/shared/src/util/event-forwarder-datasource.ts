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
 * Identifier types the Event Forwarder owns. Ownership is explicit and is only
 * ever taken at creation — nothing an earlier version wrote, and nothing a user
 * wrote, is promoted into it. Records that predate the field are linked instead,
 * which gives them their warehouse queries while leaving them fully editable.
 */
export function isEventForwarderManagedUserIdType(
  userIdType: UserIdType,
): boolean {
  return userIdType.managedBy === "api";
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

/**
 * Resolves the SDK attribute an identifier type reads its value from.
 *
 * An explicit link wins. Failing that the Linked Hash Attributes answer it: one
 * identifier type models one hash attribute, so a lone entry there *is* the
 * source. That is what recovers records written before the link existed —
 * including the `ef_`-prefixed ones, which always carried their attribute in
 * `attributes`. Nothing reads meaning from the name.
 *
 * An entry listing several attributes is a user's own construct rather than a
 * model of one attribute, so it falls through to its name.
 */
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
  // Any entry already modelling the attribute counts as present, whoever owns
  // it, so a renamed identifier is never re-added under its original name and a
  // record written before the marker existed never gains a twin.
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
 * Reconciles Event Forwarder identifier types against the hash attributes the
 * org's schema calls for. One identifier type per hash attribute, and one hash
 * attribute per identifier type.
 *
 * An attribute is matched to an entry that already models it, in this order:
 * an explicit `sourceAttribute`, then Linked Hash Attributes, then the name.
 * Only an attribute nothing models gets a new managed entry — reconciliation
 * does not mint a second identifier type for a unit the datasource already has
 * just to own one.
 *
 * Matching an entry writes the link, and the attribute into Linked Hash
 * Attributes if missing. It never writes `managedBy`: ownership is taken at
 * creation and never afterwards, so an entry a user created stays theirs, fully
 * editable and deletable, whatever it is called.
 *
 * Nothing is deleted. An entry whose attribute is gone (archived, un-flagged,
 * out of the datasource's Projects) is released — link and managed marker off,
 * record kept — for the user to clean up if they want it gone.
 */
export function reconcileEventForwarderManagedUserIdTypes(
  existing: UserIdType[],
  desired: UserIdType[],
): UserIdType[] {
  // Insertion order is attribute-schema order, which makes every tie below
  // resolve the same way on every sync.
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

  // An explicit link is the strongest claim, so it is settled before anything
  // competes for the same attribute by name or by Linked Hash Attributes.
  for (const entry of existing) {
    if ((entry.sourceAttribute ?? null) === null) {
      result.push(entry);
      continue;
    }
    const source = normalizeUserIdTypeName(entry.sourceAttribute as string);
    if (!desiredBySource.has(source) || claimedSources.has(source)) {
      result.push(releaseUserIdType(entry));
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
    // Linked Hash Attributes first: an entry already modelling the attribute is
    // the one the warehouse is wired to, so matching it keeps the existing
    // column, query, and id in place.
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
