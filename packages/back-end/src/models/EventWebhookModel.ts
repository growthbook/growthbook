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
  name: {
    type: String,
    unique: true,
    required: true,
  },
  dateCreated: Date,
  dateUpdated: Date,
  lastRunAt: Date,
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
  lastError: {
    type: String,
    required: false,
  },
  lastState: {
    type: String,
    enum: ["none", "success", "error"],
    required: true,
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
  name: string;
  url: string;
  organizationId: string;
  events: NotificationEventName[];
};

/**
 * Create an event web hook for an organization for the given events
 * @param options CreateEventWebHookOptions
 * @returns
 */
export const createEventWebHook = async ({
  name,
  url,
  organizationId,
  events,
}: CreateEventWebHookOptions): Promise<EventWebHookInterface> => {
  const now = new Date();
  const signingKey = "ewhk-" + md5(randomUUID()).substr(0, 32);

  const doc = await EventWebHookModel.create({
    id: `ewh-${randomUUID()}`,
    organizationId,
    dateCreated: now,
    dateUpdated: now,
    name,
    events,
    lastError: null,
    lastState: "none",
    signingKey,
    url,
  });

  return toInterface(doc);
};

/**
 * Given an EventWebHook.id will delete the corresponding document
 * @param eventWebHookId
 */
export const deleteEventWebHookById = async (eventWebHookId: string) => {
  await EventWebHookModel.deleteOne({
    id: eventWebHookId,
  });
};

type UpdateEventWebHookOptions = {
  name?: string;
  url?: string;
  events?: NotificationEventName[];
};

/**
 * Given an EventWebHook.id allows updating some of the properties on the document
 * @param eventWebHookId
 * @param updates UpdateEventWebHookOptions
 */
export const updateEventWebHook = async (
  eventWebHookId: string,
  updates: UpdateEventWebHookOptions
): Promise<void> => {
  await EventWebHookModel.updateOne(
    { id: eventWebHookId },
    {
      $set: {
        ...updates,
        dateUpdated: new Date(),
      },
    }
  );
};

type EventWebHookStatusUpdate =
  | {
      state: "success";
    }
  | {
      state: "error";
      error: string;
    };

export const updateEventWebHookStatus = async (
  eventWebHookId: string,
  status: EventWebHookStatusUpdate
) => {
  const lastError = status.state === "error" ? status.error : null;

  await EventWebHookModel.updateOne(
    { id: eventWebHookId },
    {
      $set: {
        lastRunAt: new Date(),
        lastState: status.state,
        lastError,
      },
    }
  );
};
