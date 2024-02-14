import { createHmac } from "crypto";
import Agenda, { Job } from "agenda";
import md5 from "md5";
import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { getFeatureDefinitions } from "../services/features";
import { CRON_ENABLED, WEBHOOKS } from "../util/secrets";
import { SDKPayloadKey } from "../../types/sdk-payload";
import {
  findSDKConnectionsByIds,
  findSDKConnectionsByOrganization,
} from "../models/SdkConnectionModel";
import { SDKConnectionInterface } from "../../types/sdk-connection";
import { logger } from "../util/logger";
import { findWebhookById, findWebhooksBySdks } from "../models/WebhookModel";
import { WebhookInterface, WebhookMethod } from "../../types/webhook";
import { createSdkWebhookLog } from "../models/SdkWebhookLogModel";
import { cancellableFetch } from "../util/http.util";
import { getContextForAgendaJobByOrgId } from "../services/organizations";
import { ReqContext } from "../../types/organization";
import { ApiReqContext } from "../../types/api";

const SDK_WEBHOOKS_JOB_NAME = "fireWebhooks";
type SDKWebhookJob = Job<{
  webhookId: string;
  retryCount: number;
}>;

let agenda: Agenda;
export default function addSdkWebhooksJob(ag: Agenda) {
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
    await queueSingleWebhookById(webhookId);
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
    webhookId: webhook.id,
    retryCount: 0,
  }) as SDKWebhookJob;
  job.unique({
    "data.webhookId": webhook.id,
  });
  job.schedule(new Date());
  await job.save();
}
export async function queueSingleWebhookJob(sdk: SDKConnectionInterface) {
  const webhooks = await findWebhooksBySdks([sdk.key]);
  for (const webhook of webhooks) {
    return webhook ? singleWebhooksJob(webhook) : null;
  }
}
export async function queueWebhookUpdate(
  context: ReqContext | ApiReqContext,
  payloadKeys: SDKPayloadKey[]
) {
  if (!CRON_ENABLED) return;
  if (!payloadKeys.length) return;
  const connections = await findSDKConnectionsByOrganization(context);

  if (!connections) return;
  const sdkKeys: string[] = [];
  for (let i = 0; i < connections.length; i++) {
    const connection = connections[i];
    // Skip if this SDK Connection isn't affected by the changes
    if (
      payloadKeys.some((key) => {
        return (
          key.environment === connection.environment &&
          (!connection.projects.length ||
            connection.projects.includes(key.project))
        );
      })
    ) {
      sdkKeys.push(connection.id);
    }
  }
  const webhooks = await findWebhooksBySdks(sdkKeys);

  for (const webhook of webhooks) {
    if (webhook) singleWebhooksJob(webhook);
  }
}

export async function fireWebhook({
  webhookId,
  organizationId,
  url,
  signingKey,
  key,
  payload,
  method,
  headers,
  sendPayload,
}: {
  webhookId: string;
  organizationId: string;
  url: string;
  signingKey: string;
  key: string;
  payload: string;
  method: WebhookMethod;
  headers: string;
  sendPayload: boolean;
}) {
  const requestTimeout = 30000;
  const maxContentSize = 1000;
  const date = new Date();
  const signature = createHmac("sha256", signingKey)
    .update(payload)
    .digest("hex");
  const secret = `whsec_${signature}`;
  const webhookID = `msg_${md5(key + date.getTime()).substr(0, 16)}`;
  const data = sendPayload ? { payload } : {};

  let body;
  if (method !== "GET") {
    body = JSON.stringify({
      type: "payload.changed",
      timestamp: date.toISOString(),
      data,
    });
  }
  let customHeaders;
  try {
    customHeaders = JSON.parse(headers);
  } catch (error) {
    createSdkWebhookLog({
      webhookId,
      webhookReduestId: webhookID,
      organizationId,
      payload: JSON.parse(payload),
      result: {
        state: "success",
        responseBody: "failed to parse custom headers",
        responseCode: 500,
      },
    });
    return;
  }
  const res = await cancellableFetch(
    url,
    {
      headers: {
        "Content-Type": "application/json",
        "webhook-id": webhookID,
        "webhook-timestamp": date.getTime(),
        "webhook-secret": secret,
        "webhook-sdk-key": key,
        ...customHeaders,
      },
      method,
      body,
    },
    {
      maxTimeMs: requestTimeout,
      maxContentSize: maxContentSize,
    }
  ).catch((e) => {
    createSdkWebhookLog({
      webhookId,
      webhookReduestId: webhookID,
      organizationId,
      payload: JSON.parse(payload),
      result: {
        state: "error",
        responseBody: e.body,
        responseCode: e.statusCode,
      },
    });
    return e;
  });

  createSdkWebhookLog({
    webhookId,
    webhookReduestId: webhookID,
    organizationId,
    payload: JSON.parse(payload),
    result: {
      state: "success",
      responseBody: res.responseBody,
      responseCode: res.statusCode,
    },
  });
  return res.responseWithoutBody;
}
export async function queueSingleWebhookById(webhookId: string) {
  const webhook = await findWebhookById(webhookId);
  if (!webhook) {
    logger.error("SDK webhook: No webhook found for id", {
      webhookId,
    });
    return;
  }

  const connections = await findSDKConnectionsByIds(webhook?.sdks);
  for (const connection of connections) {
    if (!connection) {
      logger.error("SDK webhook: Could not find sdk connection", {
        webhookId,
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
    const res = await fireWebhook({
      organizationId: connection.organization,
      webhookId: webhook.id,
      url: webhook.endpoint,
      signingKey: webhook.signingKey,
      key: connection.key,
      payload,
      headers: webhook.headers || "",
      method: webhook.httpMethod || "POST",
      sendPayload: webhook.sendPayload,
    });

    if (!res?.ok) {
      const e = "returned an invalid status code: " + res?.status;
      webhook.set("error", e);
      await webhook.save();
      return;
    }

    webhook.set("error", "");
    webhook.set("lastSuccess", new Date());
    await webhook.save();
  }
}

export async function queueGlobalWebhooks(
  context: ReqContext | ApiReqContext,
  payloadKeys: SDKPayloadKey[]
) {
  for (const webhook of WEBHOOKS) {
    const {
      url,
      signingKey,
      key,
      method,
      headers,
      sendPayload,
      webhookId,
    } = webhook;
    if (!payloadKeys.length) return;

    const connections = await findSDKConnectionsByOrganization(context);

    if (!connections) return;
    for (let i = 0; i < connections.length; i++) {
      const connection = connections[i];

      // Skip if this SDK Connection isn't affected by the changes
      if (
        payloadKeys.some(
          (key: { environment: string; project: string }) =>
            key.environment === connection.environment &&
            (!connection.projects.length ||
              connection.projects.includes(key.project))
        )
      ) {
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
        fireWebhook({
          webhookId,
          organizationId: context.org.id,
          url,
          signingKey,
          key,
          payload,
          method,
          sendPayload,
          headers: JSON.stringify(headers),
        });
      }
    }
  }
}
