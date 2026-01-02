import { fetch } from "back-end/src/util/http.util";
import { logger } from "./logger";
import { FASTLY_API_TOKEN, FASTLY_SERVICE_ID } from "./secrets";

export function getSurrogateKeysFromEnvironments(
  orgId: string,
  environments: string[],
): string[] {
  return environments.map((k) => {
    const key = `${orgId}_${k}`;

    // Protect against environments or projects having unusual characters
    return key.replace(/[^a-zA-Z0-9_-]/g, "");
  });
}

export async function purgeCDNCache(
  orgId: string,
  surrogateKeys: string[],
): Promise<void> {
  // Only purge when Fastly is used as the CDN (e.g. GrowthBook Cloud)
  if (!FASTLY_SERVICE_ID || !FASTLY_API_TOKEN) return;

  try {
    await fetch(`https://api.fastly.com/service/${FASTLY_SERVICE_ID}/purge`, {
      method: "POST",
      headers: {
        "Fastly-Key": FASTLY_API_TOKEN,
        "surrogate-key": surrogateKeys.join(" "),
        Accept: "application/json",
      },
    });
  } catch (e) {
    logger.error(e, "Failed to purge cache for " + orgId);
  }
}
