import { createHmac } from "crypto";
import Agenda, { Job } from "agenda";
import fetch from "node-fetch";
import { ReqContext } from "@back-end/types/organization";
import {
  getContextForAgendaJobByOrgId,
  getExperimentOverrides,
} from "../services/organizations";
import { getFeatureDefinitions } from "../services/features";
import { CRON_ENABLED } from "../util/secrets";
import { SDKPayloadKey } from "../../types/sdk-payload";
import {
  findAllLegacySdkWebhooks,
  findSdkWebhookByOnlyId,
  setLastSdkWebhookError,
} from "../models/WebhookModel";

const WEBHOOK_JOB_NAME = "fireWebhook";
type WebhookJob = Job<{
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

    const webhook = await findSdkWebhookByOnlyId(webhookId);
    if (!webhook) return;

    const context = await getContextForAgendaJobByOrgId(webhook.organization);

    const { features, dateUpdated } = await getFeatureDefinitions({
      context,
      capabilities: ["bucketingV2"],
      environment:
        webhook.environment === undefined ? "production" : webhook.environment,
      projects: webhook.project ? [webhook.project] : [],
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
        webhook.project
      );
      body.overrides = overrides;
      body.experiments = expIdMapping;
    }

    const payload = JSON.stringify(body);

    const signature = createHmac("sha256", webhook.signingKey)
      .update(payload)
      .digest("hex");

    const res = await fetch(webhook.endpoint, {
      headers: {
        "Content-Type": "application/json",
        "X-GrowthBook-Signature": signature,
      },
      method: "POST",
      body: payload,
    });

    if (!res.ok) {
      const e = "POST returned an invalid status code: " + res.status;
      await setLastSdkWebhookError(webhook, e);
      throw new Error(e);
    }

    await setLastSdkWebhookError(webhook, "");
  });
  agenda.on(
    "fail:" + WEBHOOK_JOB_NAME,
    async (error: Error, job: WebhookJob) => {
      if (!job.attrs.data) return;

      // record the failure:
      const webhookId = job.attrs.data?.webhookId;
      if (webhookId) {
        const webhook = await findSdkWebhookByOnlyId(webhookId);
        if (webhook) {
          await setLastSdkWebhookError(
            webhook,
            job.attrs.failReason || webhook.error || "unknown error"
          );
        }
      }

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
    }
  );
}

export async function queueLegacySdkWebhook(
  context: ReqContext,
  payloadKeys: SDKPayloadKey[],
  isFeature?: boolean
) {
  if (!CRON_ENABLED) return;
  if (!payloadKeys.length) return;

  const webhooks = await findAllLegacySdkWebhooks(context);

  for (let i = 0; i < webhooks.length; i++) {
    const webhook = webhooks[i];

    // Skip if this webhook isn't affected by the changes
    if (
      !payloadKeys.some(
        (key) =>
          key.project === (webhook.project || "") &&
          key.environment === (webhook.environment || "production")
      )
    ) {
      continue;
    }

    // Skip if this webhook is only for features and this isn't a feature event
    if (!isFeature && webhook.featuresOnly) {
      continue;
    }

    const job = agenda.create(WEBHOOK_JOB_NAME, {
      webhookId: webhook.id,
      retryCount: 0,
    }) as WebhookJob;
    job.unique({ webhookId: webhook.id });
    job.schedule(new Date());
    await job.save();
  }
}
