import mongoose from "mongoose";
import { omit } from "lodash";
import uniqid from "uniqid";
import md5 from "md5";
import { z } from "zod";
import { managedByValidator } from "shared/validators";
import { ReqContext } from "back-end/types/organization";
import { migrateWebhookModel } from "back-end/src/util/migrations";
import { WebhookInterface } from "back-end/types/webhook";

const payloadFormatValidator = z.enum([
  "standard",

  "standard-no-payload",
  "sdkPayload",
  "edgeConfig",
  "edgeConfigUnescaped",
  "vercelNativeIntegration",
  "none",
]);

export type PayloadFormat = z.infer<typeof payloadFormatValidator>;

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
  /** @deprecated */
  sendPayload: Boolean,
  payloadFormat: String,
  payloadKey: String,
  headers: String,
  httpMethod: String,
  managedBy: {},
});

type WebhookDocument = mongoose.Document & WebhookInterface;

const WebhookModel = mongoose.model<WebhookInterface>("Webhook", webhookSchema);

function toInterface(doc: WebhookDocument): WebhookInterface {
  return migrateWebhookModel(
    omit(doc.toJSON<WebhookDocument>(), ["__v", "_id"]),
  );
}

export async function findAllSdkWebhooksByConnectionIds(
  context: ReqContext,
  sdkConnectionIds: string[],
): Promise<WebhookInterface[]> {
  return (
    await WebhookModel.find({
      organization: context.org.id,
      sdks: { $in: sdkConnectionIds },
      useSdkMode: true,
    })
  ).map((e) => toInterface(e));
}

export async function findAllSdkWebhooksByPayloadFormat(
  context: ReqContext,
  payloadFormat: string,
): Promise<WebhookInterface[]> {
  return (
    await WebhookModel.find({
      organization: context.org.id,
      payloadFormat,
      useSdkMode: true,
    })
  ).map((e) => toInterface(e));
}

export async function findAllSdkWebhooksByConnection(
  context: ReqContext,
  sdkConnectionId: string,
): Promise<WebhookInterface[]> {
  return (
    await WebhookModel.find({
      organization: context.org.id,
      sdks: sdkConnectionId,
      useSdkMode: true,
    })
  ).map((e) => toInterface(e));
}

export async function findAllLegacySdkWebhooks(
  context: ReqContext,
): Promise<WebhookInterface[]> {
  return (
    await WebhookModel.find({
      organization: context.org.id,
      useSdkMode: { $ne: true },
    })
  ).map((e) => toInterface(e));
}

export async function deleteLegacySdkWebhookById(
  context: ReqContext,
  id: string,
) {
  await WebhookModel.deleteOne({
    organization: context.org.id,
    id,
    useSdkMode: { $ne: true },
  });
}

export async function deleteSdkWebhookById(context: ReqContext, id: string) {
  await WebhookModel.deleteOne({
    organization: context.org.id,
    id,
    useSdkMode: true,
  });
}

export async function setLastSdkWebhookError(
  webhook: WebhookInterface,
  error: string,
) {
  await WebhookModel.updateOne(
    {
      organization: webhook.organization,
      id: webhook.id,
    },
    {
      $set: {
        error,
        lastSuccess: error ? undefined : new Date(),
      },
    },
  );
}

export const updateSdkWebhookValidator = z
  .object({
    name: z.string().optional(),
    endpoint: z.string().optional(),
    payloadFormat: payloadFormatValidator.optional(),
    payloadKey: z.string().optional(),
    sdks: z.array(z.string()).optional(),
    httpMethod: z
      .enum(["GET", "POST", "PUT", "DELETE", "PATCH", "PURGE"])
      .optional(),
    headers: z.string().optional(),
  })
  .strict();

export type UpdateSdkWebhookProps = z.infer<typeof updateSdkWebhookValidator>;

export async function updateSdkWebhook(
  context: ReqContext,
  existing: WebhookInterface,
  updates: UpdateSdkWebhookProps,
) {
  updates = updateSdkWebhookValidator.parse(updates);

  await WebhookModel.updateOne(
    {
      organization: context.org.id,
      id: existing.id,
      useSdkMode: true,
    },
    {
      $set: {
        ...updates,
      },
    },
  );

  return {
    ...existing,
    ...updates,
  };
}

const createSdkWebhookValidator = z
  .object({
    name: z.string(),
    endpoint: z.string(),
    payloadFormat: payloadFormatValidator.optional(),
    payloadKey: z.string().optional(),
    httpMethod: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH", "PURGE"]),
    headers: z.string(),
    managedBy: managedByValidator.optional(),
  })
  .strict();
export type CreateSdkWebhookProps = z.infer<typeof createSdkWebhookValidator>;

export async function createSdkWebhook(
  context: ReqContext,
  sdkConnectionId: string,
  data: CreateSdkWebhookProps,
) {
  data = createSdkWebhookValidator.parse(data);

  const id = uniqid("wh_");
  const signingKey = "wk_" + md5(uniqid()).substr(0, 16);
  const doc: WebhookInterface = {
    ...data,
    id,
    project: "",
    environment: "",
    organization: context.org.id,
    featuresOnly: true,
    signingKey,
    created: new Date(),
    error: "",
    lastSuccess: null,
    useSdkMode: true,
    sdks: [sdkConnectionId],
  };
  const res = await WebhookModel.create(doc);

  return toInterface(res);
}

export async function findSdkWebhookByIdAcrossOrgs(id: string) {
  const doc = await WebhookModel.findOne({
    id,
  });
  return doc ? toInterface(doc) : null;
}

export async function findSdkWebhookById(context: ReqContext, id: string) {
  const doc = await WebhookModel.findOne({
    organization: context.org.id,
    id,
    useSdkMode: true,
  });
  return doc ? toInterface(doc) : null;
}

export async function findLegacySdkWebhookById(
  context: ReqContext,
  id: string,
) {
  const doc = await WebhookModel.findOne({
    organization: context.org.id,
    id,
    useSdkMode: { $ne: true },
  });
  return doc ? toInterface(doc) : null;
}

export async function countSdkWebhooksByOrg(organization: string) {
  return await WebhookModel.countDocuments({
    organization,
    useSdkMode: true,
  }).exec();
}
