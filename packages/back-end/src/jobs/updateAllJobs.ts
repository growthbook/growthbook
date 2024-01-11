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
  queueGlobalWebhooks,
  queueSingleWebhookJob,
  queueWebhookUpdate,
} from "./sdkWebhooks";
import { queueWebhook } from "./webhooks";

export const triggerWebhookJobs = async (
  orgId: string,
  payloadKeys: SDKPayloadKey[],
  environments: string[],
  isProxyEnabled: boolean,
  isFeature = true
) => {
  queueWebhookUpdate(orgId, payloadKeys);
  queueGlobalWebhooks(orgId, payloadKeys);
  if (isProxyEnabled) queueProxyUpdate(orgId, payloadKeys);
  queueWebhook(orgId, payloadKeys, isFeature);
  const surrogateKeys = getSurrogateKeysFromEnvironments(orgId, [
    ...environments,
  ]);
  await purgeCDNCache(orgId, surrogateKeys);
};

export const triggerSingleSDKWebhookJobs = async (
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

      queueSingleProxyUpdate(newConnection, IS_CLOUD);
    }
  }

  await purgeCDNCache(connection.organization, [connection.key]);
};
