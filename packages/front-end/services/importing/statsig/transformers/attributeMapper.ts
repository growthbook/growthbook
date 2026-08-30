/**
 * Map Statsig attribute names to GrowthBook attribute names
 * @param statsigAttribute The attribute name from StatSig
 * @param skipMapping If true, returns the original attribute name without mapping
 * @returns The mapped attribute name or the original if skipMapping is true
 */
export function mapStatsigAttributeToGB(
  statsigAttribute: string,
  skipMapping: boolean = false,
): string {
  if (skipMapping) {
    return statsigAttribute;
  }

  const attributeMap: Record<string, string> = {
    user_id: "id",
    userID: "id", // Alternative format
    stable_id: "deviceId",
    stableID: "deviceId", // Alternative format
    browser_name: "browser",
    os_name: "os",
    country: "country",
    app_version: "app_version",
    browser_version: "browser_version",
    os_version: "os_version",
    ip_address: "ip_address",
    email: "email",
    unit_id: "unit_id",
    time: "time",
  };

  return attributeMap[statsigAttribute] || statsigAttribute;
}
