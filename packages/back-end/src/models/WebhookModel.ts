import mongoose from "mongoose";
import { WebhookInterface } from "../../types/webhook";

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
  useSDKMode: Boolean,
  sdks: {
    type: [String],
    index: true,
  },
  sendPayload: Boolean,
});

export type WebhookDocument = mongoose.Document & WebhookInterface;

export const WebhookModel = mongoose.model<WebhookInterface>(
  "Webhook",
  webhookSchema
);
