import { createHmac } from "crypto";
import Agenda, { Job } from "agenda";
import md5 from "md5";
import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { filterProjectsByEnvironmentWithNull } from "shared/util";
import { Promise as BluebirdPromise } from "bluebird";
import { getFeatureDefinitions } from "back-end/src/services/features";
import { WEBHOOKS } from "back-end/src/util/secrets";
import { SDKPayloadKey } from "back-end/types/sdk-payload";
import {
  findSDKConnectionsByIds,
  findSDKConnectionsByOrganization,
} from "back-end/src/models/SdkConnectionModel";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { logger } from "back-end/src/util/logger";
import {
  findAllSdkWebhooksByConnection,
  findAllSdkWebhooksByConnectionIds,
  findSdkWebhookByIdAcrossOrgs,
  setLastSdkWebhookError,
} from "back-end/src/models/WebhookModel";
import { WebhookInterface, WebhookPayloadFormat } from "back-end/types/webhook";
import { createSdkWebhookLog } from "back-end/src/models/SdkWebhookLogModel";
import {
  cancellableFetch,
  CancellableFetchReturn,
} from "back-end/src/util/http.util";
import {
  getContextForAgendaJobByOrgId,
  getContextForAgendaJobByOrgObject,
} from "back-end/src/services/organizations";
import { ReqContext } from "back-end/types/organization";
import { ApiReqContext } from "back-end/types/api";

const SDK_WEBHOOKS_JOB_NAME = "fireWebhooks";
type SDKWebhookJob = Job<{
  webhookId: string;
  retryCount: number;
}>;
const sendPayloadFormats: WebhookPayloadFormat[] = [
  "standard",
  "sdkPayload",
  "edgeConfig",
  "edgeConfigUnescaped",
  "vercelNativeIntegration",
];

const fireWebhooks = async (job: SDKWebhookJob) => {
  const webhookId = job.attrs.data?.webhookId;

  if (!webhookId) {
    logger.error(
      {
        webhookId,
      },
      "SDK webhook: No webhook provided for webhook job",
    );
    return;
  }

  const webhook = await findSdkWebhookByIdAcrossOrgs(webhookId);
  if (!webhook || !webhook.sdks) {
    logger.error(
      {
        webhookId,
      },
      "SDK webhook: No webhook found for id",
    );
    return;
  }

  const context = await getContextForAgendaJobByOrgId(webhook.organization);
  await fireSdkWebhook(context, webhook);
};

let agenda: Agenda;
export default function addSdkWebhooksJob(ag: Agenda) {
  agenda = ag;
  // Fire webhooks
  agenda.define(SDK_WEBHOOKS_JOB_NAME, fireWebhooks);
  agenda.on(
    "fail:" + SDK_WEBHOOKS_JOB_NAME,
    async (error: Error, job: SDKWebhookJob) => {
      if (!job.attrs.data) return;

      // retry:
      const retryCount = job.attrs.data.retryCount;
      let nextRunAt = Date.now();
      // Wait 30s after the first failure
      if (retryCount === 0) {
        nextRunAt += 30000;
      }
      // Wait 5m after the second failure
      else if (retryCount === 1) {
        nextRunAt += 300000;
      }
      // If it failed 3 times, give up
      else {
        // TODO: email the organization owner
        return;
      }

      job.attrs.data.retryCount++;
      job.attrs.nextRunAt = new Date(nextRunAt);
      await job.save();
    },
  );
}
async function queueSingleSdkWebhookJob(webhook: WebhookInterface) {
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
export async function queueWebhooksForSdkConnection(
  context: ReqContext,
  connection: SDKConnectionInterface,
) {
  const webhooks = await findAllSdkWebhooksByConnection(context, connection.id);
  for (const webhook of webhooks) {
    if (webhook) await queueSingleSdkWebhookJob(webhook);
  }
}
export async function queueWebhooksBySdkPayloadKeys(
  context: ReqContext | ApiReqContext,
  payloadKeys: SDKPayloadKey[],
) {
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

  const webhooks = await findAllSdkWebhooksByConnectionIds(context, sdkKeys);
  for (const webhook of webhooks) {
    if (webhook) await queueSingleSdkWebhookJob(webhook);
  }
}

async function runWebhookFetch({
  webhook,
  key,
  payload,
  global,
  context,
}: {
  webhook: WebhookInterface;
  key: string;
  payload: Record<string, unknown>;
  global?: boolean;
  context: ReqContext;
}) {
  const webhookId = webhook.id;
  const url = webhook.endpoint;
  const signingKey = webhook.signingKey;
  const headers = webhook.headers || "";
  const method = webhook.httpMethod || "POST";
  const payloadFormat = webhook.payloadFormat || "standard";
  const payloadKey = webhook.payloadKey;
  const organizationId = webhook.organization;
  const requestTimeout = 30000;
  const maxContentSize = 1000;
  const jsonPayload = JSON.stringify(payload);

  const sendPayload =
    method !== "GET" && sendPayloadFormats.includes(payloadFormat);

  const date = new Date();
  const signature = createHmac("sha256", signingKey)
    .update(sendPayload ? jsonPayload : "")
    .digest("hex");
  const secret = `whsec_${signature}`;
  const webhookID = `msg_${md5(key + date.getTime()).substr(0, 16)}`;

  const timestamp = Math.floor(date.getTime() / 1000);

  let body: string | undefined;
  const standardBody = JSON.stringify({
    type: "payload.changed",
    timestamp: date.toISOString(),
    data: { payload: jsonPayload },
  });
  let invalidValue: never;

  if (method !== "GET") {
    switch (payloadFormat) {
      case "none":
        body = undefined;
        break;
      case "standard-no-payload":
        body = JSON.stringify({
          type: "payload.changed",
          timestamp: date.toISOString(),
        });
        break;
      case "sdkPayload":
        body = jsonPayload;
        break;
      case "standard":
        body = standardBody;
        break;
      case "edgeConfig":
        body = JSON.stringify({
          items: [
            {
              operation: "upsert",
              key: payloadKey || "gb_payload",
              value: jsonPayload,
            },
          ],
        });
        break;
      case "edgeConfigUnescaped":
        body = JSON.stringify({
          items: [
            {
              operation: "upsert",
              key: payloadKey || "gb_payload",
              value: payload,
            },
          ],
        });
        break;
      case "vercelNativeIntegration":
        body = JSON.stringify({
          data: {
            [payloadKey || "gb_payload"]: payload,
          },
        });
        break;
      default:
        body = standardBody;
        invalidValue = payloadFormat;
        logger.error(`Invalid webhook payload format: ${invalidValue}`);
    }
  }

  const standardSignatureBody = `${webhookID}.${timestamp}.${body || ""}`;
  const standardSignature =
    "v1," +
    createHmac("sha256", signingKey)
      .update(standardSignatureBody)
      .digest("base64");

  let res: CancellableFetchReturn | undefined = undefined;

  try {
    const origin = new URL(url).origin;
    const applySecrets =
      await context.models.webhookSecrets.getBackEndSecretsReplacer(origin);

    let customHeaders: Record<string, string> | undefined;
    if (headers) {
      try {
        customHeaders = applySecrets(JSON.parse(headers));
      } catch (error) {
        throw new Error("Failed to parse custom headers: " + error.message);
      }
    }

    res = await cancellableFetch(
      applySecrets(url, { encode: encodeURIComponent }),
      {
        headers: {
          ...customHeaders,
          "Content-Type": "application/json",
          "User-Agent": "GrowthBook Webhook",
          "webhook-id": webhookID,
          "webhook-timestamp": timestamp + "",
          "webhook-signature": standardSignature,
          "webhook-secret": secret,
          "webhook-sdk-key": key,
        },
        method,
        body,
      },
      {
        maxTimeMs: requestTimeout,
        maxContentSize: maxContentSize,
      },
    );

    if (!res.responseWithoutBody.ok) {
      throw new Error(
        "Returned an invalid status code: " + res.responseWithoutBody.status,
      );
    }

    createSdkWebhookLog({
      webhookId,
      webhookRequestId: webhookID,
      organizationId,
      payload: { data: payload },
      result: {
        state: "success",
        responseBody: res.stringBody,
        responseCode: res.responseWithoutBody.status,
      },
    });
    if (!global) await setLastSdkWebhookError(webhook, "");
    return res;
  } catch (e) {
    const message = res?.stringBody || e.message;
    createSdkWebhookLog({
      webhookId,
      webhookRequestId: webhookID,
      organizationId,
      payload: { data: payload },
      result: {
        state: "error",
        responseBody: message,
        responseCode: res?.responseWithoutBody?.status || 0,
      },
    });
    if (!global) await setLastSdkWebhookError(webhook, message);
    throw e;
  }
}
export async function fireSdkWebhook(
  context: ReqContext,
  webhook: WebhookInterface,
) {
  const webhookContext = getContextForAgendaJobByOrgObject(context.org);

  const sendPayload =
    webhook.httpMethod !== "GET" &&
    sendPayloadFormats.includes(webhook.payloadFormat ?? "standard");

  const connections = await findSDKConnectionsByIds(context, webhook?.sdks);

  if (!connections.length) {
    logger.error(
      {
        webhookId: webhook.id,
      },
      "SDK webhook: Could not find sdk connections",
    );
    return;
  }

  const payloads: [string, Record<string, unknown>][] =
    await BluebirdPromise.reduce(
      connections,
      async (payloads: [string, Record<string, unknown>][], connection) => {
        if (!sendPayload) return [[connection.key, {}], ...payloads];

        const environmentDoc = webhookContext.org?.settings?.environments?.find(
          (e) => e.id === connection.environment,
        );
        const filteredProjects = filterProjectsByEnvironmentWithNull(
          connection.projects,
          environmentDoc,
          true,
        );

        const defs = await getFeatureDefinitions({
          context: webhookContext,
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
          dateUpdated: connection.payloadUpdated,
        });

        return [[connection.key, defs], ...payloads];
      },
      [],
    );

  await BluebirdPromise.each(payloads, ([key, payload]) =>
    runWebhookFetch({
      webhook,
      key,
      payload,
      context: webhookContext,
    }),
  );
}

export async function getSDKConnectionsByPayloadKeys(
  context: ReqContext | ApiReqContext,
  payloadKeys: SDKPayloadKey[],
) {
  if (!payloadKeys.length) return [];

  const connections = await findSDKConnectionsByOrganization(context);
  if (!connections) return [];

  return connections.filter((c) => {
    const environmentDoc = context.org?.settings?.environments?.find(
      (e) => e.id === c.environment,
    );
    const filteredProjects = filterProjectsByEnvironmentWithNull(
      c.projects,
      environmentDoc,
      true,
    );
    if (!filteredProjects) {
      return false;
    }

    // Skip if this SDK Connection isn't affected by the changes
    if (
      !payloadKeys.some(
        (key) =>
          key.environment === c.environment &&
          (!filteredProjects.length || filteredProjects.includes(key.project)),
      )
    ) {
      return false;
    }
    return true;
  });
}

export async function fireGlobalSdkWebhooksByPayloadKeys(
  context: ReqContext | ApiReqContext,
  payloadKeys: SDKPayloadKey[],
) {
  const connections = await getSDKConnectionsByPayloadKeys(
    context,
    payloadKeys,
  );
  await fireGlobalSdkWebhooks(context, connections);
}

export async function fireGlobalSdkWebhooks(
  context: ReqContext | ApiReqContext,
  connections: SDKConnectionInterface[],
) {
  if (!connections.length) return;

  for (const connection of connections) {
    const environmentDoc = context.org?.settings?.environments?.find(
      (e) => e.id === connection.environment,
    );
    const filteredProjects = filterProjectsByEnvironmentWithNull(
      connection.projects,
      environmentDoc,
      true,
    );

    const payload = await getFeatureDefinitions({
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
      dateUpdated: connection.payloadUpdated,
    });

    WEBHOOKS.forEach((webhook) => {
      const {
        url,
        signingKey,
        method,
        headers,
        sendPayload,
        payloadFormat,
        payloadKey,
      } = webhook;
      let format = payloadFormat;
      if (!format) {
        if (method === "GET") {
          format = "none";
        } else if (sendPayload) {
          format = "standard";
        } else {
          format = "standard-no-payload";
        }
      }

      const id = `global_${md5(url)}`;
      const w: WebhookInterface = {
        id,
        endpoint: url,
        signingKey: signingKey || id,
        httpMethod: method,
        headers:
          typeof headers !== "string" ? JSON.stringify(headers) : headers,
        payloadFormat: format,
        payloadKey,
        organization: context.org?.id,
        created: new Date(),
        error: "",
        lastSuccess: new Date(),
        name: "",
        sdks: [connection.key],
        useSdkMode: true,
        featuresOnly: true,
      };

      runWebhookFetch({
        webhook: w,
        key: connection.key,
        payload,
        global: true,
        context: context,
      }).catch((e) => {
        logger.error(e, "Failed to fire global webhook");
      });
    });
  }
}
