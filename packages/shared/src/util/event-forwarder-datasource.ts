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

// Event Forwarder managed identifier types (and the exposure queries that feed
// them) are prefixed so they never collide with identifier types / queries a
// user already created for the same hash attribute. The prefix is applied once,
// here, when building the identifier type from the attribute. The underlying
// source attribute is recoverable by stripping the prefix, which the SQL
// generators use so extraction still reads the real attribute.
export const EVENT_FORWARDER_MANAGED_IDENTIFIER_ID_PREFIX = "ef_";

export function buildEventForwarderManagedIdentifierId(
  attributeProperty: string,
): string {
  // The prefix is applied unconditionally — even when the source attribute
  // already starts with "ef_". This is intentional: an attribute literally
  // named "ef_userId" must not collapse into the same managed id a user could
  // have created themselves, and the source attribute is recovered by stripping
  // exactly one prefix (see getEventForwarderManagedIdentifierSourceAttribute),
  // so "ef_userId" -> "ef_ef_userId" -> "ef_userId" round-trips correctly.
  return `${EVENT_FORWARDER_MANAGED_IDENTIFIER_ID_PREFIX}${attributeProperty}`;
}

export function isEventForwarderManagedIdentifierId(
  userIdType: string,
): boolean {
  return userIdType.startsWith(EVENT_FORWARDER_MANAGED_IDENTIFIER_ID_PREFIX);
}

// Resolves the source SDK attribute for a managed identifier id (e.g.
// "ef_user_id" -> "user_id"). Non-managed identifier types are returned as-is.
export function getEventForwarderManagedIdentifierSourceAttribute(
  userIdType: string,
): string {
  return isEventForwarderManagedIdentifierId(userIdType)
    ? userIdType.slice(EVENT_FORWARDER_MANAGED_IDENTIFIER_ID_PREFIX.length)
    : userIdType;
}

export function getEventForwarderSinkTypeForDatasource(datasource: {
  type: DataSourceType;
}): EventForwarderSinkType | null {
  switch (datasource.type) {
    case "bigquery":
      return "bigquery";
    case "snowflake":
      return "snowflake";
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
      userIdType: buildEventForwarderManagedIdentifierId(a.property),
      description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
      attributes: [a.property],
    }));
}

export function isHashAttributeUserIdType(
  userIdType: string,
  attributeSchema: SDKAttributeSchema,
  datasourceProjects?: string[],
): boolean {
  // Managed identifier types are prefixed (e.g. "ef_user_id"); resolve back to
  // the source attribute so the hash-attribute lookup still matches.
  const sourceAttribute =
    getEventForwarderManagedIdentifierSourceAttribute(userIdType).toLowerCase();
  return attributeSchema.some(
    (attribute) =>
      attribute.hashAttribute &&
      !attribute.archived &&
      attribute.property.toLowerCase() === sourceAttribute &&
      attributeMatchesDatasourceProjects(attribute, datasourceProjects),
  );
}

export function isEventForwarderAllowedUserIdTypesChange(
  existing: UserIdType[],
  updated: UserIdType[],
): boolean {
  // Only Event Forwarder managed identifier types (prefixed with `ef_`) are
  // locked. User-created identifier types that happen to use the same hash
  // attribute remain editable / deletable.
  const lockedExisting = existing.filter((item) =>
    isEventForwarderManagedIdentifierId(item.userIdType),
  );

  return lockedExisting.every((locked) => {
    const match = updated.find(
      (item) =>
        item.userIdType.toLowerCase() === locked.userIdType.toLowerCase(),
    );
    if (!match || match.userIdType !== locked.userIdType) {
      return false;
    }

    const lockedAttributes = locked.attributes ?? [];
    const updatedAttributes = match.attributes ?? [];
    return (
      lockedAttributes.length === updatedAttributes.length &&
      lockedAttributes.every(
        (attribute, index) => attribute === updatedAttributes[index],
      )
    );
  });
}

export function getUserIdTypesToAdd(
  existing: UserIdType[],
  built: UserIdType[],
): UserIdType[] {
  const existingIds = new Set(existing.map((u) => u.userIdType.toLowerCase()));
  return built.filter((u) => !existingIds.has(u.userIdType.toLowerCase()));
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
