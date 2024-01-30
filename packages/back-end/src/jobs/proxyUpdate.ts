import { createHmac } from "crypto";
import Agenda, { Job } from "agenda";
import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { getFeatureDefinitions } from "../services/features";
import { CRON_ENABLED, IS_CLOUD } from "../util/secrets";
import { SDKPayloadKey } from "../../types/sdk-payload";
import {
  clearProxyError,
  findSDKConnectionById,
  findSDKConnectionsByOrganization,
  setProxyError,
} from "../models/SdkConnectionModel";
import { SDKConnectionInterface } from "../../types/sdk-connection";
import { cancellableFetch } from "../util/http.util";
import { logger } from "../util/logger";
import { getContextForAgendaJobByOrgId } from "../services/organizations";

const PROXY_UPDATE_JOB_NAME = "proxyUpdate";
type ProxyUpdateJob = Job<{
  connectionId: string;
  useCloudProxy: boolean;
  retryCount: number;
}>;

let agenda: Agenda;
export default function addProxyUpdateJob(ag: Agenda) {
  agenda = ag;

  // Fire webhooks
  agenda.define(PROXY_UPDATE_JOB_NAME, async (job: ProxyUpdateJob) => {
    const connectionId = job.attrs.data?.connectionId;
    const useCloudProxy = job.attrs.data?.useCloudProxy;
    if (!connectionId) {
      logger.error(
        "proxyUpdate: No connectionId provided for proxy update job",
        { connectionId, useCloudProxy }
      );
      return;
    }

    const connection = await findSDKConnectionById(connectionId);
    if (!connection) {
      logger.error("proxyUpdate: Could not find sdk connection", {
        connectionId,
        useCloudProxy,
      });
      return;
    }

    const context = await getContextForAgendaJobByOrgId(
      connection.organization
    );

    const defs = await getFeatureDefinitions({
      context,
      capabilities: getConnectionSDKCapabilities(connection),
      environment: connection.environment,
      projects: connection.projects,
      encryptionKey: connection.encryptPayload
        ? connection.encryptionKey
        : undefined,
      includeVisualExperiments: connection.includeVisualExperiments,
      includeDraftExperiments: connection.includeDraftExperiments,
      includeExperimentNames: connection.includeExperimentNames,
      hashSecureAttributes: connection.hashSecureAttributes,
    });

    const payload = JSON.stringify(defs);

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
  });
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
    }
  );
}

export async function queueSingleProxyUpdate(
  connection: SDKConnectionInterface,
  useCloudProxy: boolean = false
) {
  if (!connectionSupportsProxyUpdate(connection, useCloudProxy)) return;

  const job = agenda.create(PROXY_UPDATE_JOB_NAME, {
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
  orgId: string,
  payloadKeys: SDKPayloadKey[]
) {
  if (!CRON_ENABLED) return;
  if (!payloadKeys.length) return;

  const connections = await findSDKConnectionsByOrganization(orgId);

  if (!connections) return;

  for (let i = 0; i < connections.length; i++) {
    const connection = connections[i];

    // Skip if this SDK Connection isn't affected by the changes
    if (
      !payloadKeys.some(
        (key) =>
          key.environment === connection.environment &&
          (!connection.projects.length ||
            connection.projects.includes(key.project))
      )
    ) {
      continue;
    }

    if (IS_CLOUD) {
      // Always fire webhook to GB Cloud Proxy for cloud users
      await queueSingleProxyUpdate(connection, true);
    }
    // If connection (cloud or self-hosted) specifies an (additional) proxy host, fire webhook
    await queueSingleProxyUpdate(connection, false);
  }
}

function connectionSupportsProxyUpdate(
  connection: SDKConnectionInterface,
  useCloudProxy: boolean
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
    }
  );

  return res;
}
