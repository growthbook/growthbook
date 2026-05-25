import { UserIdType } from "shared/types/datasource";
import { SDKAttribute, SDKAttributeSchema } from "shared/types/organization";

const EVENT_FORWARDER_FACT_TABLE_COLUMN_FIELDS = [
  "property",
  "datatype",
  "hashAttribute",
] as const satisfies readonly (keyof SDKAttribute)[];

export function attributeUpdateAffectsEventForwarderFactTableColumns(
  before: SDKAttribute,
  after: SDKAttribute,
): boolean {
  return EVENT_FORWARDER_FACT_TABLE_COLUMN_FIELDS.some(
    (field) => before[field] !== after[field],
  );
}

export function attributeMatchesDatasourceProjects(
  attribute: SDKAttribute,
  datasourceProjects: string[] | undefined,
): boolean {
  // A project-scoped attribute only matches a project-scoped datasource when
  // they share at least one project. A global datasource (no projects) or a
  // global attribute (no projects) always matches.
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
      description: a.description ?? "",
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
