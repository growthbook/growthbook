import { randomUUID } from "crypto";
import omit from "lodash/omit";
import mongoose from "mongoose";
import { migrateSdkWebhookLogModel } from "back-end/src/util/migrations";
import { SdkWebHookLogInterface } from "back-end/types/sdk-webhook-log";

const sdkWebHookLogSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
    required: true,
  },
  organizationId: {
    type: String,
    required: true,
  },
  webhookId: {
    type: String,
    required: true,
  },
  /** @deprecated */
  webhookReduestId: {
    type: String,
    required: false,
  },
  webhookRequestId: {
    type: String,
    required: true,
  },
  dateCreated: {
    type: Date,
    required: true,
  },
  responseCode: {
    type: Number,
    required: false,
  },
  responseBody: {
    type: String,
    required: false,
  },
  result: {
    type: String,
    enum: ["success", "error"],
    required: true,
  },
  payload: {
    type: Object,
    required: true,
  },
});

sdkWebHookLogSchema.index({ eventWebHookId: 1 });

export type SdkWebHookLogDocument = mongoose.Document & SdkWebHookLogInterface;

const toInterface = (doc: SdkWebHookLogDocument): SdkWebHookLogDocument => {
  const asJson = omit(doc.toJSON(), ["__v", "_id"]) as SdkWebHookLogDocument;
  return migrateSdkWebhookLogModel(asJson);
};

const SdkWebHookLogModel = mongoose.model<SdkWebHookLogInterface>(
  "SdkWebHookLog",
  sdkWebHookLogSchema,
);

type CreateSdkWebHookLogOptions = {
  organizationId: string;
  webhookId: string;
  webhookRequestId: string;
  payload: Record<string, unknown>;
  result:
    | {
        state: "error";
        responseBody: string;
        responseCode: number | null;
      }
    | {
        state: "success";
        responseCode: number;
        responseBody: string;
      };
};

/**
 * Create an sdk web hook log item.
 * @param options CreateSdkWebHookLogOptions
 * @returns Promise<SdkWebHookLogInterface>
 */
export const createSdkWebhookLog = async ({
  webhookId,
  webhookRequestId,
  organizationId,
  payload,
  result: resultState,
}: CreateSdkWebHookLogOptions): Promise<SdkWebHookLogInterface> => {
  const now = new Date();

  const doc = await SdkWebHookLogModel.create({
    id: `swhl-${randomUUID()}`,
    dateCreated: now,
    webhookId,
    webhookRequestId,
    organizationId,
    result: resultState.state,
    responseCode: resultState.responseCode,
    responseBody: resultState.responseBody,
    payload,
  });

  return toInterface(doc);
};

/**
 * Get the latest web hook runs for a web hook
 * @param organizationId
 * @param sdkWebHookId
 * @param limit
 * @returns
 */
export const getLatestRunsForWebHook = async (
  organizationId: string,
  sdkWebHookId: string,
  limit: number = 10,
): Promise<SdkWebHookLogInterface[]> => {
  const docs = await SdkWebHookLogModel.find({
    sdkWebHookId,
    organizationId,
  })
    .sort([["dateCreated", -1]])
    .limit(limit);

  return docs.map(toInterface);
};
