import mongoose from "mongoose";
import { WebhookInterface } from "@/types/webhook";

const webhookSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organization: {
    type: String,
    index: true,
  },
  name: String,
  endpoint: String,
  project: String,
  environment: String,
  featuresOnly: Boolean,
  signingKey: String,
  lastSuccess: Date,
  error: String,
  created: Date,
  useSdkMode: Boolean,
  sdks: {
    type: [String],
    index: true,
  },
  sendPayload: Boolean,
  headers: String,
  httpMethod: String,
});

export type WebhookDocument = mongoose.Document & WebhookInterface;

export const WebhookModel = mongoose.model<WebhookInterface>(
  "Webhook",
  webhookSchema
);

export async function findWebhooksBySdks(
  sdkKeys: string[]
): Promise<WebhookInterface[]> {
  return (
    await WebhookModel.find({
      sdks: { $in: sdkKeys },
      useSdkMode: true,
    })
  ).map((e) => e.toJSON());
}

export async function findWebhookById(id: string) {
  return await WebhookModel.findOne({
    id,
  });
}

export async function countWebhooksByOrg(organization: string) {
  return await WebhookModel.countDocuments({ organization }).exec();
}
