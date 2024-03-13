import uniqid from "uniqid";
import md5 from "md5";
import { WebhookModel } from "@back-end/src/models/WebhookModel";
import { WebhookInterface, WebhookMethod } from "@back-end/types/webhook";

type CreateWebhook = {
  organization: string;
  name: string;
  endpoint: string;
  project?: string;
  environment?: string;
  useSdkMode?: boolean;
  sdks?: string[];
  sendPayload?: boolean;
  httpMethod?: WebhookMethod;
  headers?: string;
};
type CreateSdkWebhook = {
  organization: string;
  name: string;
  endpoint: string;
  sdkid: string;
  sendPayload: boolean;
  httpMethod: WebhookMethod;
  headers: string;
};
export async function createSdkWebhook({
  organization,
  name,
  endpoint,
  sdkid,
  sendPayload,
  headers,
  httpMethod,
}: CreateSdkWebhook): Promise<string> {
  const sdks = [sdkid];
  return createWebhook({
    organization,
    name,
    endpoint,
    useSdkMode: true,
    sdks,
    sendPayload,
    headers,
    httpMethod,
  });
}

export async function createWebhook({
  organization,
  name,
  endpoint,
  project,
  environment,
  useSdkMode,
  sdks,
  sendPayload,
  headers,
  httpMethod,
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
    useSdkMode: useSdkMode || false,
    sdks: sdks || [],
    sendPayload: sendPayload || false,
    headers: headers || "",
    httpMethod: httpMethod || "POST",
  };
  await WebhookModel.create(doc);

  return id;
}
