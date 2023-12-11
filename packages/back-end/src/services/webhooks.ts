import uniqid from "uniqid";
import md5 from "md5";
import { WebhookModel } from "../models/WebhookModel";
import { WebhookInterface } from "../../types/webhook";

type CreateWebhook = {
  organization: string;
  name: string;
  endpoint: string;
  project?: string;
  environment?: string;
  useSDKMode?: boolean;
  sdks?: string[];
  sendPayload?: boolean;
};
type CreateWebhookSDK = {
  organization: string;
  name: string;
  endpoint: string;
  sdkid: string;
  sendPayload: boolean;
};
export async function createWebhookSDK({
  organization,
  name,
  endpoint,
  sdkid,
  sendPayload,
}: CreateWebhookSDK): Promise<string> {
  const sdks = [sdkid];
  return createWebhook({
    organization,
    name,
    endpoint,
    useSDKMode: true,
    sdks,
    sendPayload,
  });
}

export async function createWebhook({
  organization,
  name,
  endpoint,
  project,
  environment,
  useSDKMode,
  sdks,
  sendPayload,
}: CreateWebhook): Promise<string> {
  const id = uniqid("wh_");
  const signingKey = "wk_" + md5(uniqid()).substr(0, 16);

  const doc: WebhookInterface = {
    id,
    name,
    organization,
    endpoint,
    project: project || "",
    environment: environment || "",
    featuresOnly: true,
    signingKey,
    created: new Date(),
    error: "",
    lastSuccess: null,
    useSDKMode: useSDKMode || false,
    sdks: sdks || [],
    sendPayload: sendPayload || true,
  };
  await WebhookModel.create(doc);

  return id;
}
