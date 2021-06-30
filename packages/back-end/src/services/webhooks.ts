import uniqid from "uniqid";
import md5 from "md5";
import { WebhookModel } from "../models/WebhookModel";
import { WebhookInterface } from "../../types/webhook";

export async function createWebhook(
  organization: string,
  name: string,
  endpoint: string
): Promise<string> {
  const id = uniqid("wh_");
  const signingKey = "wk_" + md5(uniqid()).substr(0, 16);

  const doc: WebhookInterface = {
    id,
    name,
    organization,
    endpoint,
    signingKey,
    created: new Date(),
    error: "",
    lastSuccess: null,
  };

  await WebhookModel.create(doc);

  return id;
}
