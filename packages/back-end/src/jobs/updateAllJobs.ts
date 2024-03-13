import { IS_CLOUD } from "@back-end/src/util/secrets";
import {
  getSurrogateKeysFromEnvironments,
  purgeCDNCache,
} from "@back-end/src/util/cdn.util";
import { SDKPayloadKey } from "@back-end/types/sdk-payload";
import {
  ProxyConnection,
  SDKConnectionInterface,
} from "@back-end/types/sdk-connection";
import { ReqContext } from "@back-end/types/organization";
import { ApiReqContext } from "@back-end/types/api";
import { queueWebhook } from "./webhooks";
import {
  queueGlobalWebhooks,
  queueSingleWebhookJob,
  queueWebhookUpdate,
} from "./sdkWebhooks";
import { queueProxyUpdate, queueSingleProxyUpdate } from "./proxyUpdate";

export const triggerWebhookJobs = async (
  context: ReqContext | ApiReqContext,
  payloadKeys: SDKPayloadKey[],
  environments: string[],
  isProxyEnabled: boolean,
  isFeature = true
) => {
  queueWebhookUpdate(context, payloadKeys);
  queueGlobalWebhooks(context, payloadKeys);
  if (isProxyEnabled) queueProxyUpdate(context, payloadKeys);
  queueWebhook(context.org.id, payloadKeys, isFeature);
  const surrogateKeys = getSurrogateKeysFromEnvironments(context.org.id, [
    ...environments,
  ]);
  await purgeCDNCache(context.org.id, surrogateKeys);
};

export const triggerSingleSDKWebhookJobs = async (
  orgId: string,
  connection: SDKConnectionInterface,
  otherChanges: Partial<SDKConnectionInterface>,
  newProxy: ProxyConnection,
  isUsingProxy: boolean
) => {
  queueSingleWebhookJob(connection);
  if (isUsingProxy) {
    if (IS_CLOUD) {
      const newConnection = {
        ...connection,
        ...otherChanges,
        proxy: newProxy,
      } as SDKConnectionInterface;

      queueSingleProxyUpdate(orgId, newConnection, IS_CLOUD);
    }
  }

  await purgeCDNCache(connection.organization, [connection.key]);
};
