import { createHmac } from "crypto";
import Agenda, { Job } from "agenda";
import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { filterProjectsByEnvironmentWithNull } from "shared/util";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { getFeatureDefinitions } from "back-end/src/services/features";
import { IS_CLOUD } from "back-end/src/util/secrets";
import {
  clearProxyError,
  findSDKConnectionById,
  setProxyError,
} from "back-end/src/models/SdkConnectionModel";
import { cancellableFetch } from "back-end/src/util/http.util";
import { logger } from "back-end/src/util/logger";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { getSDKPayloadCacheLocation } from "back-end/src/models/SdkConnectionCacheModel";

const PROXY_UPDATE_JOB_NAME = "proxyUpdate";
type ProxyUpdateJob = Job<{
  orgId: string;
  connectionId: string;
  useCloudProxy: boolean;
  retryCount: number;
}>;

const proxyUpdate = async (job: ProxyUpdateJob) => {
  const connectionId = job.attrs.data?.connectionId;
  const orgId = job.attrs.data?.orgId;
  const useCloudProxy = job.attrs.data?.useCloudProxy;
  if (!connectionId) {
    logger.error(
      {
        connectionId,
        useCloudProxy,
      },
      "proxyUpdate: No connectionId provided for proxy update job",
    );
    return;
  }

  if (!orgId) {
    logger.error(
      {
        connectionId,
        useCloudProxy,
      },
      "proxyUpdate: No orgId provided for proxy update job",
    );
    return;
  }

  const context = await getContextForAgendaJobByOrgId(orgId);

  const connection = await findSDKConnectionById(context, connectionId);
  if (!connection) {
    logger.error(
      {
        connectionId,
        useCloudProxy,
      },
      "proxyUpdate: Could not find sdk connection",
    );
    return;
  }

  if (!useCloudProxy && !connection.proxy.host) {
    logger.error(
      {
        connectionId,
        useCloudProxy,
      },
      "proxyUpdate: Proxy host is missing",
    );
    return;
  }

  // Try to get cached payload from sdkConnectionCache
  let payload: string | undefined;
  const storageLocation = getSDKPayloadCacheLocation();

  if (storageLocation !== "none") {
    const cached = await context.models.sdkConnectionCache.getById(
      connection.key,
    );
    if (cached) {
      // Validate that it's valid JSON before using it
      try {
        JSON.parse(cached.contents);
        payload = cached.contents;
      } catch (e) {
        // Corrupt cache data, treat as cache miss and regenerate
        logger.warn(e, "Failed to parse cached SDK payload, regenerating");
      }
    }
  }

  // Generate if cache disabled, cache miss, or corrupt cache
  if (!payload) {
    const environmentDoc = context.org?.settings?.environments?.find(
      (e) => e.id === connection.environment,
    );
    const filteredProjects = filterProjectsByEnvironmentWithNull(
      connection.projects,
      environmentDoc,
      true,
    );

    const defs = await getFeatureDefinitions({
      context,
      capabilities: getConnectionSDKCapabilities(connection),
      environment: connection.environment,
      projects: filteredProjects,
      encryptionKey: connection.encryptPayload
        ? connection.encryptionKey
        : undefined,
      includeVisualExperiments: connection.includeVisualExperiments,
      includeDraftExperiments: connection.includeDraftExperiments,
      includeExperimentNames: connection.includeExperimentNames,
      includeRedirectExperiments: connection.includeRedirectExperiments,
      includeRuleIds: connection.includeRuleIds,
      hashSecureAttributes: connection.hashSecureAttributes,
    });

    payload = JSON.stringify(defs);
  }

  // note: Cloud users will typically have proxy.enabled === false (unless using a local proxy), but will still have a valid proxy.signingKey
  const signature = createHmac("sha256", connection.proxy.signingKey)
    .update(payload)
    .digest("hex");

  const url = useCloudProxy
    ? `https://proxy.growthbook.io/proxy/features`
    : `${connection.proxy.host.replace(/\/$/, "")}/proxy/features`;

  const res = await fireProxyWebhook({
    url,
    signature,
    key: connection.key,
    payload,
  });

  if (!res.ok) {
    const e = "POST returned an invalid status code: " + res.status;
    await setProxyError(connection, e);
    throw new Error(e);
  }

  await clearProxyError(connection);
};

let agenda: Agenda;
export default function addProxyUpdateJob(ag: Agenda) {
  agenda = ag;

  // Fire webhooks
  agenda.define(PROXY_UPDATE_JOB_NAME, proxyUpdate);
  agenda.on(
    "fail:" + PROXY_UPDATE_JOB_NAME,
    async (error: Error, job: ProxyUpdateJob) => {
      if (!job.attrs.data) return;

      // retry:
      const retryCount = job.attrs.data.retryCount;
      let nextRunAt = Date.now();
      // Try again after 5 seconds
      if (retryCount === 0) {
        nextRunAt += 5000;
      }
      // If it failed twice, give up
      else {
        return;
      }

      job.attrs.data.retryCount++;
      job.attrs.nextRunAt = new Date(nextRunAt);
      await job.save();
    },
  );
}

export async function queueSingleProxyUpdate(
  orgId: string,
  connection: SDKConnectionInterface,
  useCloudProxy: boolean = false,
) {
  if (!connectionSupportsProxyUpdate(connection, useCloudProxy)) return;

  const job = agenda.create(PROXY_UPDATE_JOB_NAME, {
    orgId,
    connectionId: connection.id,
    retryCount: 0,
    useCloudProxy,
  }) as ProxyUpdateJob;
  job.unique({
    "data.connectionId": connection.id,
    "data.useCloudProxy": useCloudProxy,
  });
  job.schedule(new Date());
  await job.save();
}

export async function queueProxyUpdate(
  context: ReqContext | ApiReqContext,
  connections: SDKConnectionInterface[],
) {
  if (!connections.length) return;

  for (let i = 0; i < connections.length; i++) {
    const connection = connections[i];

    if (IS_CLOUD) {
      // Always fire webhook to GB Cloud Proxy for cloud users
      await queueSingleProxyUpdate(context.org.id, connection, true);
    }
    // If connection (cloud or self-hosted) specifies an (additional) proxy host, fire webhook
    await queueSingleProxyUpdate(context.org.id, connection, false);
  }
}

function connectionSupportsProxyUpdate(
  connection: SDKConnectionInterface,
  useCloudProxy: boolean,
) {
  if (useCloudProxy) {
    return IS_CLOUD;
  }
  return !!(connection.proxy.enabled && connection.proxy.host);
}

async function fireProxyWebhook({
  url,
  signature,
  key,
  payload,
}: {
  url: string;
  signature: string;
  key: string;
  payload: string;
}) {
  const { responseWithoutBody: res } = await cancellableFetch(
    url,
    {
      headers: {
        "Content-Type": "application/json",
        "X-GrowthBook-Signature": signature,
        "X-GrowthBook-Api-Key": key,
      },
      method: "POST",
      body: payload,
    },
    {
      maxContentSize: 500,
      maxTimeMs: 5000,
    },
  );

  return res;
}
