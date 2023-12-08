import uniqid from "uniqid";
import md5 from "md5";
import { WebhookModel } from "../models/WebhookModel";
import { WebhookInterface } from "../../types/webhook";

export async function createWebhook(
  organization: string,
  name: string,
  endpoint: string,
  useSDKMode: boolean,
  SDKs: string[],
  sendPayload?: boolean,
  project?: string,
  environment?: string
): Promise<string> {
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
    useSDKMode,
    SDKs: SDKs || []
    sendPayload: sendPayload || true,
  };

  await WebhookModel.create(doc);

  return id;
}
