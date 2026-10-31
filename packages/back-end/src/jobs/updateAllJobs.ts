import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { SDKPayloadKey } from "back-end/types/sdk-payload";
import {
  getSurrogateKeysFromEnvironments,
  purgeCDNCache,
} from "back-end/src/util/cdn.util";
import { logger } from "back-end/src/util/logger";
import {
  FASTLY_API_TOKEN,
  FASTLY_SERVICE_ID,
  IS_CLOUD,
  PROXY_ENABLED,
  PROXY_HOST_INTERNAL,
  PROXY_HOST_PUBLIC,
  WEBHOOKS,
} from "back-end/src/util/secrets";
import { queueProxyUpdate } from "./proxyUpdate";
import {
  fireGlobalSdkWebhooks,
  queueWebhooksByConnections,
} from "./sdkWebhooks";
import { queueLegacySdkWebhooks } from "./webhooks";

// Whether anything would be notified by triggerWebhookJobs for this org: the
// cloud proxy, global SDK webhooks, a Fastly CDN purge, an env-configured
// proxy, or an enabled SDK or legacy webhook. Environment checks run first so
// the database is only read when none of them apply. Per-connection proxy
// settings aren't read since outside cloud they are overwritten from the
// environment (see addEnvProxySettings).
export async function hasSdkPayloadListeners(
  context: ReqContext | ApiReqContext,
): Promise<boolean> {
  if (IS_CLOUD) return true;
  if (WEBHOOKS.length) return true;
  if (FASTLY_SERVICE_ID && FASTLY_API_TOKEN) return true;
  if (PROXY_ENABLED && (PROXY_HOST_INTERNAL || PROXY_HOST_PUBLIC)) return true;

  const sdkWebhooks = await context.models.sdkWebhooks.getAll();
  if (sdkWebhooks.some((w) => !w.disabled)) return true;

  const legacyWebhooks =
    await context.models.sdkWebhooks.findAllLegacySdkWebhooks();
  return legacyWebhooks.some((w) => !w.disabled);
}

// Any new notification type added here needs a matching check in
// hasSdkPayloadListeners, or refreshes will be skipped when there is no
// payload cache.
export const triggerWebhookJobs = async (
  context: ReqContext | ApiReqContext,
  payloadKeys: SDKPayloadKey[],
  connections: SDKConnectionInterface[],
  isProxyEnabled: boolean,
  isFeature = true,
) => {
  queueWebhooksByConnections(context, connections).catch((e) => {
    logger.error(e, "Error queueing webhooks");
  });

  fireGlobalSdkWebhooks(context, connections).catch((e) => {
    logger.error(e, "Error firing global webhooks");
  });

  if (isProxyEnabled) {
    queueProxyUpdate(context, connections).catch((e) => {
      logger.error(e, "Error queueing proxy update");
    });
  }

  queueLegacySdkWebhooks(context, payloadKeys, isFeature).catch((e) => {
    logger.error(e, "Error queueing legacy webhooks");
  });

  // Purge by environment
  const environments = Array.from(
    new Set(payloadKeys.map((k) => k.environment)),
  );
  const surrogateKeys = getSurrogateKeysFromEnvironments(context.org.id, [
    ...environments,
  ]);

  // If any connections are in a different environment, purge them individually
  connections.forEach((conn) => {
    if (!environments.includes(conn.environment)) {
      surrogateKeys.push(conn.key);
    }
  });

  await purgeCDNCache(context.org.id, surrogateKeys);
};
