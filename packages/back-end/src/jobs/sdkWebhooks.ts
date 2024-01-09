import { createHmac } from "crypto";
import Agenda, { Job } from "agenda";
import md5 from "md5";
import { getFeatureDefinitions } from "../services/features";
import { CRON_ENABLED } from "../util/secrets";
import { SDKPayloadKey } from "../../types/sdk-payload";
import {
  findSDKConnectionsByKeys,
  findSDKConnectionsByOrganization,
  setProxyError,
} from "../models/SdkConnectionModel";
import { SDKConnectionInterface } from "../../types/sdk-connection";
import { cancellableFetch } from "../util/http.util";
import { logger } from "../util/logger";
import { findWebhookById, findWebhooksBySDks } from "../models/WebhookModel";
import { WebhookInterface, WebhookMethod } from "../../types/webhook";

const SDK_WEBHOOKS_JOB_NAME = "fireWebhooks";
type SDKWebhookJob = Job<{
  webhookId: string;
  retryCount: number;
}>;

let agenda: Agenda;
export default function addWebhooksJob(ag: Agenda) {
  agenda = ag;

  // Fire webhooks
  agenda.define(SDK_WEBHOOKS_JOB_NAME, async (job: SDKWebhookJob) => {
    const webhookId = job.attrs.data?.webhookId;

    if (!webhookId) {
      logger.error("SDK webhook: No webhook provided for webhook job", {
        webhookId,
      });
      return;
    }

    const webhook = await findWebhookById(webhookId);
    if (!webhook) {
      logger.error("SDK webhook: No webhook found for id", {
        webhookId,
      });
      return;
    }
    const connections = await findSDKConnectionsByKeys(webhook?.sdks);
    for (const connection of connections) {
      if (!connection) {
        logger.error("SDK webhook: Could not find sdk connection", {
          webhookId,
        });
        return;
      }

      // TODO This probably needs to renamed
      const defs = await getFeatureDefinitions({
        organization: connection.organization,
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

      const res = await fireWebhook({
        url: webhook.endpoint,
        signingKey: webhook.signingKey,
        key: connection.key,
        payload,
        headers: webhook.headers || "",
        method: webhook.method || "POST",
      });

      if (!res.ok) {
        const e = "POST returned an invalid status code: " + res.status;
        await setProxyError(connection, e);
        throw new Error(e);
      }

      await setProxyError(connection, "");
    }
  });
  agenda.on(
    "fail:" + SDK_WEBHOOKS_JOB_NAME,
    async (error: Error, job: SDKWebhookJob) => {
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
async function singleWebhooksJob(webhook: WebhookInterface) {
  const job = agenda.create(SDK_WEBHOOKS_JOB_NAME, {
    webhook: webhook.id,
    retryCount: 0,
  }) as SDKWebhookJob;
  job.unique({
    "data.webhookId": webhook.id,
  });
  job.schedule(new Date());
  await job.save();
}
export async function queseSingleWebhookJob(sdk: SDKConnectionInterface) {
  const webhooks = await findWebhooksBySDks([sdk.key]);
  for (const webhook of webhooks) {
    return webhook ? singleWebhooksJob(webhook) : null;
  }
}
export async function queueWebhookUpdate(
  orgId: string,
  payloadKeys: SDKPayloadKey[]
) {
  if (!CRON_ENABLED) return;
  if (!payloadKeys.length) return;

  const connections = await findSDKConnectionsByOrganization(orgId);

  if (!connections) return;
  const sdkKeys = [];
  for (let i = 0; i < connections.length; i++) {
    const connection = connections[i];

    // Skip if this SDK Connection isn't affected by the changes
    if (
      payloadKeys.some(
        (key) =>
          key.environment === connection.environment &&
          (!connection.projects.length ||
            connection.projects.includes(key.project))
      )
    ) {
      sdkKeys.push(connection.key);
    }
  }
  const webhooks = await findWebhooksBySDks(sdkKeys);

  for (const webhook of webhooks) {
    if (webhook) singleWebhooksJob(webhook);
  }
}

async function fireWebhook({
  url,
  signingKey,
  key,
  payload,
  method,
  headers,
}: {
  url: string;
  signingKey: string;
  key: string;
  payload: string;
  method: WebhookMethod;
  headers: string;
}) {
  const date = new Date();
  const signature = createHmac("sha256", signingKey)
    .update(payload)
    .digest("hex");
  const secret = `whsec_${signature}`;
  const webhookID = `msg_${md5(key + date.getTime()).substr(0, 16)}`;
  const body = {
    type: "payload.changed",
    timestamp: date.toISOString(),
    data: {
      payload,
    },
  };
  const { responseWithoutBody: res } = await cancellableFetch(
    url,
    {
      headers: {
        "Content-Type": "application/json",
        "webhook-id": webhookID,
        "webhook-timestamp": date.getTime(),
        "webhook-secret": secret,
        "webhook-sdk-key": key,
        ...JSON.parse(headers),
      },
      method,
      body: JSON.stringify(body),
    },
    {
      maxContentSize: 500,
      maxTimeMs: 5000,
    }
  );

  return res;
}
