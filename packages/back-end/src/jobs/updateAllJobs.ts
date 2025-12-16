import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { SDKPayloadKey } from "back-end/types/sdk-payload";
import {
  getSurrogateKeysFromEnvironments,
  purgeCDNCache,
} from "back-end/src/util/cdn.util";
import { logger } from "back-end/src/util/logger";
import { queueProxyUpdate } from "./proxyUpdate";
import {
  fireGlobalSdkWebhooks,
  queueWebhooksByConnections,
} from "./sdkWebhooks";
import { queueLegacySdkWebhooks } from "./webhooks";

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
