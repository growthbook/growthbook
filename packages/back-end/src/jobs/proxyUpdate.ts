import { createHmac } from "crypto";
import Agenda, { Job } from "agenda";
import { getFeatureDefinitions } from "../services/features";
import { CRON_ENABLED } from "../util/secrets";
import { SDKPayloadKey } from "../../types/sdk-payload";
import {
  findSDKConnectionById,
  findSDKConnectionsByOrganization,
  setProxyError,
} from "../models/SdkConnectionModel";
import { SDKConnectionInterface } from "../../types/sdk-connection";
import { cancellableFetch } from "../util/http.util";

const PROXY_UPDATE_JOB_NAME = "proxyUpdate";
type ProxyUpdateJob = Job<{
  connectionId: string;
  retryCount: number;
}>;

let agenda: Agenda;
export default function addProxyUpdateJob(ag: Agenda) {
  agenda = ag;

  // Fire webhooks
  agenda.define(PROXY_UPDATE_JOB_NAME, async (job: ProxyUpdateJob) => {
    const connectionId = job.attrs.data?.connectionId;
    if (!connectionId) return;

    const connection = await findSDKConnectionById(connectionId);
    if (!connection) return;
    if (!connection.proxy.enabled) return;
    if (!connection.proxy.host) return;

    const defs = await getFeatureDefinitions(
      connection.organization,
      connection.environment,
      connection.project,
      connection.encryptPayload ? connection.encryptionKey : undefined
    );

    const payload = JSON.stringify(defs);

    const signature = createHmac("sha256", connection.proxy.signingKey)
      .update(payload)
      .digest("hex");

    const { responseWithoutBody: res } = await cancellableFetch(
      `${connection.proxy.host}/proxy/features`,
      {
        headers: {
          "Content-Type": "application/json",
          "X-GrowthBook-Signature": signature,
          "X-GrowthBook-Api-Key": connection.key,
        },
        method: "POST",
        body: payload,
      },
      {
        maxContentSize: 500,
        maxTimeMs: 5000,
      }
    );

    if (!res.ok) {
      const e = "POST returned an invalid status code: " + res.status;
      await setProxyError(connection, e);
      throw new Error(e);
    }

    await setProxyError(connection, "");
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
  connection: SDKConnectionInterface
) {
  if (!connection.proxy.enabled || !connection.proxy.host) return;
  const job = agenda.create(PROXY_UPDATE_JOB_NAME, {
    connectionId: connection.id,
    retryCount: 0,
  }) as ProxyUpdateJob;
  job.unique({
    "data.connectionId": connection.id,
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
          key.project === connection.project &&
          key.environment === connection.environment
      )
    ) {
      continue;
    }

    await queueSingleProxyUpdate(connection);
  }
}
