import { createHmac } from "crypto";
import Agenda, { Job } from "agenda";
import { ReqContext } from "back-end/types/request";
import {
  getContextForAgendaJobByOrgId,
  getExperimentOverrides,
} from "back-end/src/services/organizations";
import { getFeatureDefinitionsWithCache } from "back-end/src/controllers/features";
import { formatLegacyCacheKey } from "back-end/src/models/SdkConnectionCacheModel";
import { SDKPayloadKey } from "back-end/types/sdk-payload";
import { cancellableFetch } from "back-end/src/util/http.util";
import { SdkWebhookModel } from "back-end/src/models/WebhookModel";

const WEBHOOK_JOB_NAME = "fireWebhook";
type WebhookJob = Job<{
  organizationId: string;
  webhookId: string;
  retryCount: number;
}>;

let agenda: Agenda;
export default function (ag: Agenda) {
  agenda = ag;

  // Fire webhooks
  agenda.define(WEBHOOK_JOB_NAME, async (job: WebhookJob) => {
    const webhookId = job.attrs.data?.webhookId;
    if (!webhookId) return;

    const webhook =
      await SdkWebhookModel.dangerousFindSdkWebhookByIdAcrossOrgs(webhookId);
    if (!webhook) return;

    const organizationId =
      job.attrs.data?.organizationId ?? webhook.organization;

    if (webhook.organization !== organizationId) {
      throw new Error(
        `Legacy webhook job organizationId mismatch: job has ${organizationId}, webhook has ${webhook.organization} (webhookId=${webhookId})`,
      );
    }

    const context = await getContextForAgendaJobByOrgId(organizationId);

    // Build synthetic cache key for legacy webhook
    const cacheKey = formatLegacyCacheKey({
      apiKey: `webhook_${webhookId}`,
      environment:
        webhook.environment === undefined ? "production" : webhook.environment,
      project: webhook.project || "",
    });

    const { features, dateUpdated } = await getFeatureDefinitionsWithCache({
      context,
      params: {
        key: cacheKey,
        organization: context.org.id,
        environment:
          webhook.environment === undefined
            ? "production"
            : webhook.environment,
        projects: webhook.project ? [webhook.project] : [],
        encryptPayload: false,
        encryptionKey: "",
        languages: ["legacy"],
        sdkVersion: "0.0.0",
      },
    });

    // eslint-disable-next-line
    const body: any = {
      timestamp: Math.floor(Date.now() / 1000),
      features,
      dateUpdated,
    };

    if (!webhook.featuresOnly) {
      const { overrides, expIdMapping } = await getExperimentOverrides(
        context,
        webhook.project,
      );
      body.overrides = overrides;
      body.experiments = expIdMapping;
    }

    const payload = JSON.stringify(body);

    const signature = createHmac("sha256", webhook.signingKey)
      .update(payload)
      .digest("hex");

    const res = await cancellableFetch(
      webhook.endpoint,
      {
        headers: {
          "Content-Type": "application/json",
          "X-GrowthBook-Signature": signature,
        },
        method: "POST",
        body: payload,
      },
      {
        maxTimeMs: 30000,
        maxContentSize: 1000,
      },
    );

    if (!res.responseWithoutBody.ok) {
      const e =
        res.stringBody ||
        "POST returned an invalid status code: " +
          res.responseWithoutBody.status;
      await context.models.sdkWebhooks.setLastSdkWebhookError(webhook, e);
      throw new Error(e);
    }

    await context.models.sdkWebhooks.setLastSdkWebhookError(webhook, "");
  });

  agenda.on(
    "fail:" + WEBHOOK_JOB_NAME,
    async (error: Error, job: WebhookJob) => {
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

export async function queueLegacySdkWebhooks(
  context: ReqContext,
  payloadKeys: SDKPayloadKey[],
  isFeature?: boolean,
) {
  if (!payloadKeys.length) return;

  const webhooks = await context.models.sdkWebhooks.findAllLegacySdkWebhooks();

  for (let i = 0; i < webhooks.length; i++) {
    const webhook = webhooks[i];

    // Skip if this webhook isn't affected by the changes
    if (
      !payloadKeys.some(
        (key) =>
          key.project === (webhook.project || "") &&
          key.environment === (webhook.environment || "production"),
      )
    ) {
      continue;
    }

    // Skip if this webhook is only for features and this isn't a feature event
    if (!isFeature && webhook.featuresOnly) {
      continue;
    }

    const job = agenda.create(WEBHOOK_JOB_NAME, {
      organizationId: webhook.organization,
      webhookId: webhook.id,
      retryCount: 0,
    }) as WebhookJob;
    job.unique({ webhookId: webhook.id });
    job.schedule(new Date());
    await job.save();
  }
}
