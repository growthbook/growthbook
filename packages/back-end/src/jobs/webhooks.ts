import { createHmac } from "crypto";
import Agenda, { Job } from "agenda";
import fetch from "node-fetch";
import { WebhookModel } from "../models/WebhookModel";
import { getExperimentOverrides } from "../services/organizations";
import { getFeatureDefinitions } from "../services/features";
import { WebhookInterface } from "../../types/webhook";
import { CRON_ENABLED } from "../util/secrets";
import { SDKPayloadKey } from "../../types/sdk-payload";

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

    const webhook = await WebhookModel.findOne({
      id: webhookId,
    });

    if (!webhook) return;

    const { features, dateUpdated } = await getFeatureDefinitions(
      webhook.organization,
      webhook.environment === undefined ? "production" : webhook.environment,
      webhook.project || ""
    );

    // eslint-disable-next-line
    const body: any = {
      timestamp: Math.floor(Date.now() / 1000),
      features,
      dateUpdated,
    };

    if (!webhook.featuresOnly) {
      const { overrides, expIdMapping } = await getExperimentOverrides(
        webhook.organization,
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
      webhook.set("error", e);
      await webhook.save();
      throw new Error(e);
    }

    webhook.set("error", "");
    webhook.set("lastSuccess", new Date());
    await webhook.save();
  });
  agenda.on(
    "fail:" + WEBHOOK_JOB_NAME,
    async (error: Error, job: WebhookJob) => {
      if (!job.attrs.data) return;

      // record the failure:
      const webhookId = job.attrs.data?.webhookId;
      if (webhookId) {
        const webhook = await WebhookModel.findOne({
          id: webhookId,
        });
        if (webhook) {
          webhook.set("error", "Error: " + job.attrs.failReason || "unknown");
          await webhook.save();
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

export async function queueWebhook(
  orgId: string,
  payloadKeys: SDKPayloadKey[],
  isFeature?: boolean
) {
  if (!CRON_ENABLED) return;
  if (!payloadKeys.length) return;

  const webhooks = await WebhookModel.find({
    organization: orgId,
  });

  if (!webhooks) return;

  for (let i = 0; i < webhooks.length; i++) {
    const webhook: WebhookInterface = webhooks[i];

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
