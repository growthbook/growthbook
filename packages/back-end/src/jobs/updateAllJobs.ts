import {
  ProxyConnection,
  SDKConnectionInterface,
} from "shared/types/sdk-connection";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { SDKPayloadKey } from "back-end/types/sdk-payload";
import {
  getSurrogateKeysFromEnvironments,
  purgeCDNCache,
} from "back-end/src/util/cdn.util";
import { logger } from "back-end/src/util/logger";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { queueProxyUpdate, queueSingleProxyUpdate } from "./proxyUpdate";
import {
  fireGlobalSdkWebhooks,
  fireGlobalSdkWebhooksByPayloadKeys,
  queueWebhooksBySdkPayloadKeys,
  queueWebhooksForSdkConnection,
} from "./sdkWebhooks";
import { queueLegacySdkWebhooks } from "./webhooks";

export const triggerWebhookJobs = async (
  context: ReqContext | ApiReqContext,
  payloadKeys: SDKPayloadKey[],
  environments: string[],
  isProxyEnabled: boolean,
  isFeature = true,
) => {
  queueWebhooksBySdkPayloadKeys(context, payloadKeys).catch((e) => {
    logger.error(e, "Error queueing webhooks");
  });
  fireGlobalSdkWebhooksByPayloadKeys(context, payloadKeys).catch((e) => {
    logger.error(e, "Error firing global webhooks");
  });
  if (isProxyEnabled) {
    queueProxyUpdate(context, payloadKeys).catch((e) => {
      logger.error(e, "Error queueing proxy update");
    });
  }
  queueLegacySdkWebhooks(context, payloadKeys, isFeature).catch((e) => {
    logger.error(e, "Error queueing legacy webhooks");
  });
  const surrogateKeys = getSurrogateKeysFromEnvironments(context.org.id, [
    ...environments,
  ]);
  await purgeCDNCache(context.org.id, surrogateKeys);
};

export const triggerSingleSDKWebhookJobs = async (
  context: ReqContext,
  connection: SDKConnectionInterface,
  otherChanges: Partial<SDKConnectionInterface>,
  newProxy: ProxyConnection,
  isUsingProxy: boolean,
) => {
  queueWebhooksForSdkConnection(context, connection).catch((e) => {
    logger.error(e, "Error queueing webhooks");
  });
  if (isUsingProxy) {
    if (IS_CLOUD) {
      const newConnection = {
        ...connection,
        ...otherChanges,
        proxy: newProxy,
      } as SDKConnectionInterface;

      queueSingleProxyUpdate(context.org.id, newConnection, IS_CLOUD).catch(
        (e) => {
          logger.error(e, "Error queueing single proxy update");
        },
      );
    }
  }

  fireGlobalSdkWebhooks(context, [connection]).catch((e) => {
    logger.error(e, "Error firing global webhook");
  });

  await purgeCDNCache(connection.organization, [connection.key]);
};
