import Agenda, { Job } from "agenda";
import mongoose from "mongoose";
import { WebhookModel } from "../models/WebhookModel";
import { createHmac } from "crypto";
import fetch from "node-fetch";
import { getExperimentOverrides } from "../services/organizations";

const WEBHOOK_JOB_NAME = "fireWebhook";
type WebhookJob = Job<{
  orgId: string;
  retryCount: number;
}>;

let agenda: Agenda;
export async function queueInit() {
  agenda = new Agenda({
    mongo: mongoose.connection.db,
  });

  agenda.define(WEBHOOK_JOB_NAME, async (job: WebhookJob) => {
    const { orgId } = job.attrs.data;

    const webhooks = await WebhookModel.find({
      organization: orgId,
    });

    const overrides = await getExperimentOverrides(orgId);
    const payload = JSON.stringify({
      timestamp: Math.floor(Date.now() / 1000),
      overrides,
    });

    await Promise.all(
      webhooks.map(async (webhook) => {
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
      })
    );
  });
  agenda.on(
    "fail:" + WEBHOOK_JOB_NAME,
    async (error: Error, job: WebhookJob) => {
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
      // If it failed 3 times, give up and alert the organization owner
      else {
        // TODO: email the organization owner
        console.error("Webhook failed 3 times in a row", error);
        return;
      }

      job.attrs.data.retryCount++;
      job.attrs.nextRunAt = new Date(nextRunAt);
      await job.save();
    }
  );

  await agenda.start();
}

export async function queueWebhook(orgId: string) {
  // Only queue if the organization has at least 1 webhook defined
  const webhook = await WebhookModel.findOne({
    organization: orgId,
  });
  if (!webhook) return;

  const job = agenda.create(WEBHOOK_JOB_NAME, {
    orgId,
    retryCount: 0,
  }) as WebhookJob;
  job.unique({ orgId });
  job.schedule(new Date());
  await job.save();
}
