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
import { IS_CLOUD } from "../util/secrets";
import { queueProxyUpdate, queueSingleProxyUpdate } from "./proxyUpdate";
import {
  queueGlobalSdkWebhooks,
  queueSdkWebhook,
  queueSingleWebhookJob,
} from "./sdkWebhooks";
import { queueLegacySdkWebhook } from "./webhooks";

export const triggerWebhookJobs = async (
  context: ReqContext | ApiReqContext,
  payloadKeys: SDKPayloadKey[],
  environments: string[],
  isProxyEnabled: boolean,
  isFeature = true
) => {
  queueSdkWebhook(context, payloadKeys);
  queueGlobalSdkWebhooks(context, payloadKeys);
  if (isProxyEnabled) queueProxyUpdate(context, payloadKeys);
  queueLegacySdkWebhook(context, payloadKeys, isFeature);
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
  queueSingleWebhookJob(context, connection);
  if (isUsingProxy) {
    if (IS_CLOUD) {
      const newConnection = {
        ...connection,
        ...otherChanges,
        proxy: newProxy,
      } as SDKConnectionInterface;

      queueSingleProxyUpdate(context.org.id, newConnection, IS_CLOUD);
    }
  }

  await purgeCDNCache(connection.organization, [connection.key]);
};
