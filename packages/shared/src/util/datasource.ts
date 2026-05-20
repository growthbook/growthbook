import { UserIdType } from "shared/types/datasource";
import { SDKAttribute, SDKAttributeSchema } from "shared/types/organization";

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
      description: a.description ?? "",
      attributes: [a.property],
    }));
}

export function mergeUserIdTypes(
  existing: UserIdType[],
  built: UserIdType[],
): UserIdType[] {
  const existingIds = new Set(existing.map((u) => u.userIdType.toLowerCase()));
  const toAdd = built.filter(
    (u) => !existingIds.has(u.userIdType.toLowerCase()),
  );
  if (toAdd.length === 0) {
    return existing;
  }
  return [...existing, ...toAdd];
}
