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
  fireGlobalSdkWebhooks,
  queueSingleSdkWebhookJobs,
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
  queueSingleSdkWebhookJobs(context, payloadKeys);
  fireGlobalSdkWebhooks(context, payloadKeys);
  if (isProxyEnabled) queueProxyUpdate(context, payloadKeys);
  queueLegacySdkWebhooks(context, payloadKeys, isFeature);
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
  queueWebhooksForSdkConnection(context, connection);
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
