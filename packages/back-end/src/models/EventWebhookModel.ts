import z from "zod";
import _ from "lodash";
import md5 from "md5";
import mongoose from "mongoose";
import {
  NotificationEventName,
  notificationEventNames,
} from "../events/base-types";
import { errorStringFromZodResult } from "../util/validation";
import { EventWebHookInterface } from "../../types/event-webhook";
import { randomUUID } from "crypto";

const eventWebHookSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
    required: true,
  },
  dateCreated: Date,
  dateUpdated: Date,
  organizationId: {
    type: String,
    required: true,
  },
  events: {
    type: [String],
    required: true,
    validate: {
      validator(value: unknown) {
        const zodSchema = z.array(z.enum(notificationEventNames)).min(1);

        const result = zodSchema.safeParse(value);

        if (!result.success) {
          const errorString = errorStringFromZodResult(result);
          console.error("Invalid Event name ", errorString);
        }

        return result.success;
      },
    },
  },
  signingKey: {
    type: String,
    required: true,
  },
  url: {
    type: String,
    required: true,
  },
  error: {
    type: String,
    required: false,
  },
});

eventWebHookSchema.index({ organizationId: 1 });

type EventWebHookDocument = mongoose.Document & EventWebHookInterface;

/**
 * Convert the Mongo document to an EventWebHookDocument, omitting Mongo default fields __v, _id
 * @param doc
 * @returns
 */
const toInterface = (doc: EventWebHookDocument): EventWebHookDocument =>
  _.omit(doc.toJSON(), ["__v", "_id"]) as EventWebHookDocument;

const EventWebHookModel = mongoose.model<EventWebHookDocument>(
  "EventWebHook",
  eventWebHookSchema
);

type CreateEventWebHookOptions = {
  url: string;
  organizationId: string;
  events: NotificationEventName[];
};

export const createEventWebHook = async ({
  url,
  organizationId,
  events,
}: CreateEventWebHookOptions) => {
  const now = new Date();
  const signingKey = "ewhk-" + md5(randomUUID()).substr(0, 32);

  const doc = await EventWebHookModel.create({
    id: `ewh-${randomUUID()}`,
    organizationId,
    dateCreated: now,
    dateUpdated: now,
    events,
    error: null,
    signingKey,
    url,
  });

  return toInterface(doc);
};
