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
