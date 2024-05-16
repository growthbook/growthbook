import { ApiReqContext } from "../../types/api";
import { ReqContext } from "../../types/organization";
import {
  ProxyConnection,
  SDKConnectionInterface,
} from "../../types/sdk-connection";
import { SDKPayloadKey } from "../../types/sdk-payload";
import {
  getSurrogateKeysFromEnvironments,
  purgeCDNCache,
} from "../util/cdn.util";
import { logger } from "../util/logger";
import { IS_CLOUD } from "../util/secrets";
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
  isFeature = true
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
  isUsingProxy: boolean
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
        }
      );
    }
  }

  fireGlobalSdkWebhooks(context, [connection]).catch((e) => {
    logger.error(e, "Error firing global webhook");
  });

  await purgeCDNCache(connection.organization, [connection.key]);
};
