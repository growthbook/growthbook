import uniqid from "uniqid";
import md5 from "md5";
import { WebhookInterface } from "@/back-end/types/webhook";
import { WebhookModel } from "../models/WebhookModel";

export async function createWebhook(
  organization: string,
  name: string,
  endpoint: string,
  project: string,
  environment: string
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
  };

  await WebhookModel.create(doc);

  return id;
}
