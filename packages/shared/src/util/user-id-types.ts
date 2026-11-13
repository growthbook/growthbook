import { UserIdType } from "shared/types/datasource";

/**
 * An identifier type name doubles as the column name GrowthBook selects in
 * generated SQL, so it's limited to lowercase letters and underscores.
 */
export const USER_ID_TYPE_NAME_PATTERN = /^[a-z_]+$/;

export const USER_ID_TYPE_NAME_RULE =
  "Only lowercase letters and underscores allowed. For example, 'user_id' or 'device_cookie'.";

export function isValidUserIdTypeName(name: string): boolean {
  return USER_ID_TYPE_NAME_PATTERN.test(name);
}

/**
 * The column a "deviceId", "Device-ID", or "ga4Id" attribute most likely lives
 * in: device_id, device_id, ga_id. Falls back to "id" when nothing usable is
 * left.
 */
export function attributeToUserIdTypeName(attribute: string): string {
  const name = attribute
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return name || "id";
}

// Links the attribute to the identifier type, creating the type if it's new.
export function addAttributeToUserIdTypes(
  userIdTypes: UserIdType[],
  userIdType: string,
  attribute: string,
  description?: string,
): UserIdType[] {
  if (!userIdTypes.some((type) => type.userIdType === userIdType)) {
    return [
      ...userIdTypes,
      {
        userIdType,
        ...(description && { description }),
        attributes: [attribute],
      },
    ];
  }
  return userIdTypes.map((type) =>
    type.userIdType !== userIdType || type.attributes?.includes(attribute)
      ? type
      : { ...type, attributes: [...(type.attributes ?? []), attribute] },
  );
}

export function renameAttributeInUserIdTypes(
  userIdTypes: UserIdType[],
  from: string,
  to: string,
): UserIdType[] {
  return userIdTypes.map((type) =>
    type.attributes?.includes(from)
      ? {
          ...type,
          attributes: [
            ...new Set(type.attributes.map((a) => (a === from ? to : a))),
          ],
        }
      : type,
  );
}

// Ignores case and separators, so teamId, team_id and Team-ID compare equal.
function normalizeUserIdTypeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The existing identifier type that most likely holds an attribute: one with
 * the same name, or else the only one whose name contains it or is contained
 * in it. Null when there's no clear match.
 */
export function findSimilarUserIdType(
  userIdTypes: string[],
  attribute: string,
): string | null {
  const target = normalizeUserIdTypeName(attribute);
  if (!target) return null;
  const exact = userIdTypes.find((t) => normalizeUserIdTypeName(t) === target);
  if (exact) return exact;
  const partial = userIdTypes.filter((t) => {
    const name = normalizeUserIdTypeName(t);
    return name.includes(target) || target.includes(name);
  });
  return partial.length === 1 ? partial[0] : null;
}
