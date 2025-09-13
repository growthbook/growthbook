/**
 * Map StatSig attribute names to GrowthBook attribute names
 */
export function mapStatSigAttributeToGB(statSigAttribute: string): string {
  const attributeMap: Record<string, string> = {
    userID: "id",
    user_id: "id", // Alternative format
    stableID: "deviceId",
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
    // TODO: Handle custom_field -> {field} mapping where field property becomes attribute name
  };

  return attributeMap[statSigAttribute] || statSigAttribute;
}
