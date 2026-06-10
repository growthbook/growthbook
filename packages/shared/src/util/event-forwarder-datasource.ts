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
  "Managed by Event Forwarder from your Organization Attributes.";

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
      userIdType: a.property,
      description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
      attributes: [a.property],
    }));
}

export function isHashAttributeUserIdType(
  userIdType: string,
  attributeSchema: SDKAttributeSchema,
  datasourceProjects?: string[],
): boolean {
  return attributeSchema.some(
    (attribute) =>
      attribute.hashAttribute &&
      !attribute.archived &&
      attribute.property.toLowerCase() === userIdType.toLowerCase() &&
      attributeMatchesDatasourceProjects(attribute, datasourceProjects),
  );
}

export function isEventForwarderAllowedUserIdTypesChange(
  existing: UserIdType[],
  updated: UserIdType[],
  attributeSchema: SDKAttributeSchema,
  datasourceProjects?: string[],
): boolean {
  const lockedExisting = existing.filter((item) =>
    isHashAttributeUserIdType(
      item.userIdType,
      attributeSchema,
      datasourceProjects,
    ),
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
