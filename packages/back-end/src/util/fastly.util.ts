import fetch from "node-fetch";
import { getSurrogateKey } from "../services/features";
import { SDKPayloadKey } from "../../types/sdk-payload";
import { logger } from "./logger";
import { FASTLY_API_TOKEN, FASTLY_SERVICE_ID } from "./secrets";

export async function purgeCDNCache(
  orgId: string,
  payloadKeys: SDKPayloadKey[]
): Promise<void> {
  // Only purge when Fastly is used as the CDN (e.g. GrowthBook Cloud)
  if (!FASTLY_SERVICE_ID || !FASTLY_API_TOKEN) return;

  // Only purge the specific payloads that are affected
  const surrogateKeys = payloadKeys.map((k) =>
    getSurrogateKey(orgId, k.project, k.environment)
  );
  if (!surrogateKeys.length) return;

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
    logger.error("Failed to purge cache for " + orgId);
  }
}
