import Agenda, { Job } from "agenda";
import { WebhookModel } from "../models/WebhookModel";
import { createHmac } from "crypto";
import fetch from "node-fetch";
import { getExperimentOverrides } from "../services/organizations";
import { getFeatureDefinitions } from "../services/features";

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

    const { overrides, expIdMapping } = await getExperimentOverrides(
      webhook.organization
    );
    const features = await getFeatureDefinitions(
      webhook.organization,
      "production"
    );
    const payload = JSON.stringify({
      timestamp: Math.floor(Date.now() / 1000),
      overrides,
      experiments: expIdMapping,
      features,
    });

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

export async function queueWebhook(orgId: string) {
  // Only queue if the organization has at least 1 webhook defined
  const webhooks = await WebhookModel.find({
    organization: orgId,
  });

  if (!webhooks) return;

  for (let i = 0; i < webhooks.length; i++) {
    const webhookId = webhooks[i].id as string;
    const job = agenda.create(WEBHOOK_JOB_NAME, {
      webhookId,
      retryCount: 0,
    }) as WebhookJob;
    job.unique({ webhookId });
    job.schedule(new Date());
    await job.save();
  }
}
