import { randomUUID } from "crypto";
import lodash from "lodash";
import mongoose from "mongoose";
import {
  EventWebHookLegacyLogInterface,
  EventWebHookLogInterface,
} from "shared/types/event-webhook-log";
import { EventWebHookMethod } from "shared/types/event-webhook";
import { NotificationEventName } from "shared/types/events/event";

const { omit } = lodash;
const eventWebHookLogSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
    required: true,
  },
  event: String,
  url: String,
  method: String,
  eventWebHookId: {
    type: String,
    required: true,
  },
  organizationId: {
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

eventWebHookLogSchema.index({ eventWebHookId: 1 });

type EventWebHookLogDocument = mongoose.Document & EventWebHookLogInterface;

type EventWebHookLegacyLogDocument = mongoose.Document &
  EventWebHookLegacyLogInterface;

const toLegacyInterface = (
  doc: EventWebHookLegacyLogDocument,
): EventWebHookLegacyLogDocument =>
  omit(doc.toJSON(), ["__v", "_id"]) as EventWebHookLegacyLogDocument;

const toInterface = (doc: EventWebHookLogDocument): EventWebHookLogDocument =>
  omit(doc.toJSON(), ["__v", "_id"]) as EventWebHookLogDocument;

const EventWebHookLegacyLogModel =
  mongoose.model<EventWebHookLegacyLogInterface>(
    "EventWebHookLog",
    eventWebHookLogSchema,
  );

const EventWebHookLogModel = mongoose.model<EventWebHookLogInterface>(
  "EventWebHookLog",
  eventWebHookLogSchema,
);

type CreateEventWebHookLogOptions = {
  organizationId: string;
  eventWebHookId: string;
  event: NotificationEventName;
  url: string;
  method: EventWebHookMethod;
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
 * Create an event web hook log item.
 * @param options CreateEventWebHookLogOptions
 * @returns Promise<EventWebHookLogInterface>
 */
export const createEventWebHookLog = async ({
  eventWebHookId,
  organizationId,
  payload,
  event,
  url,
  method,
  result: resultState,
}: CreateEventWebHookLogOptions): Promise<EventWebHookLogInterface> => {
  const now = new Date();

  const doc = await EventWebHookLogModel.create({
    id: `ewhl-${randomUUID()}`,
    dateCreated: now,
    event,
    url,
    method,
    eventWebHookId,
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
 * @param eventWebHookId
 * @param limit
 * @returns
 */
export const getLatestRunsForWebHook = async (
  organizationId: string,
  eventWebHookId: string,
  limit: number = 10,
): Promise<EventWebHookLegacyLogInterface[]> => {
  const docs = await EventWebHookLegacyLogModel.find({
    eventWebHookId,
    organizationId,
  })
    .sort([["dateCreated", -1]])
    .limit(limit);

  return docs.map(toLegacyInterface);
};
