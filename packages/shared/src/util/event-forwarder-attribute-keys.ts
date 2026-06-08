/**
 * Maps SDK attribute property names to keys used in the forwarder `attributes`
 * map after ingestor promotion/enrichment. Enriched/promoted keys are listed
 * first; SDK keys are fallbacks for COALESCE in warehouse SQL.
 *
 * Keep aligned with growthbook-ingestor `buildForwarderAttributeEntries` and
 * sdk-js `growthbook-tracking` / `auto-attributes` plugins.
 */
const EVENT_FORWARDER_ATTRIBUTE_LOOKUP_KEYS: Record<string, string[]> = {
  utmsource: ["utm_source"],
  utmmedium: ["utm_medium"],
  utmcampaign: ["utm_campaign"],
  utmterm: ["utm_term"],
  utmcontent: ["utm_content"],
  pagetitle: ["page_title"],
  browser: ["ua_browser", "browser"],
  devicetype: ["ua_device_type", "deviceType"],
  path: ["url_path", "path"],
  host: ["url_host", "host"],
  // url_query is JSON-encoded; query is the raw querystring from the SDK.
  query: ["url_query", "query"],
};

function sanitizeEventForwarderAvroFieldName(property: string): string {
  const sanitized = property.replace(/[^A-Za-z0-9_]+/g, "_");
  const withPrefix = /^[A-Za-z_]/.test(sanitized) ? sanitized : `_${sanitized}`;
  return withPrefix.slice(0, 255);
}

/**
 * Returns ordered keys to read inside the `attributes` map for a given SDK
 * attribute property. Enriched/promoted keys come first; SDK keys are
 * fallbacks when multiple keys are returned.
 */
export function resolveEventForwarderAttributeLookupKeys(
  property: string,
): string[] {
  const mapped = EVENT_FORWARDER_ATTRIBUTE_LOOKUP_KEYS[property.toLowerCase()];
  if (mapped) {
    return mapped;
  }

  return [sanitizeEventForwarderAvroFieldName(property)];
}
