/**
 * An identifier type name doubles as the column name GrowthBook selects in
 * generated SQL, so it follows SQL identifier rules: lowercase letters,
 * numbers, and underscores, and it can't start with a number.
 */
export const USER_ID_TYPE_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/;

export const USER_ID_TYPE_NAME_RULE =
  "Only lowercase letters, numbers, and underscores allowed, and it can't start with a number. For example, 'user_id' or 'device_cookie'.";

export function isValidUserIdTypeName(name: string): boolean {
  return USER_ID_TYPE_NAME_PATTERN.test(name);
}

/**
 * The column a "deviceId", "Device-ID", or "ga4Id" attribute most likely lives
 * in: device_id, device_id, ga4_id. Prefixes names that would otherwise be
 * empty or start with a number rather than dropping characters.
 */
export function attributeToUserIdTypeName(attribute: string): string {
  const name = attribute
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return isValidUserIdTypeName(name) ? name : `id_${name}`;
}
