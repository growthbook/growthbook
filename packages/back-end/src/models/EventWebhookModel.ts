import { randomUUID } from "crypto";
import z from "zod";
import omit from "lodash/omit";
import md5 from "md5";
import mongoose from "mongoose";
import {
  NotificationEventName,
  notificationEventNames,
} from "../events/base-types";
import { errorStringFromZodResult } from "../util/validation";
import { EventWebHookInterface } from "../../types/event-webhook";
import { logger } from "../util/logger";

const eventWebHookSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
    required: true,
  },
  organizationId: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  dateCreated: {
    type: Date,
    required: true,
  },
  dateUpdated: {
    type: Date,
    required: true,
  },
  enabled: {
    type: Boolean,
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
          logger.error(errorString, "Invalid Event name");
        }

        return result.success;
      },
    },
  },
  url: {
    type: String,
    required: true,
  },
  signingKey: {
    type: String,
    required: true,
  },
  lastRunAt: {
    type: Date,
    required: false,
  },
  lastState: {
    type: String,
    enum: ["none", "success", "error"],
    required: true,
  },
  lastResponseBody: {
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
const toInterface = (doc: EventWebHookDocument): EventWebHookInterface =>
  omit(doc.toJSON(), ["__v", "_id"]) as EventWebHookInterface;

const EventWebHookModel = mongoose.model<EventWebHookDocument>(
  "EventWebHook",
  eventWebHookSchema
);

type CreateEventWebHookOptions = {
  name: string;
  url: string;
  organizationId: string;
  enabled: boolean;
  events: NotificationEventName[];
};

/**
 * Create an event web hook for an organization for the given events
 * @param options CreateEventWebHookOptions
 * @returns Promise<EventWebHookInterface>
 */
export const createEventWebHook = async ({
  name,
  url,
  organizationId,
  enabled,
  events,
}: CreateEventWebHookOptions): Promise<EventWebHookInterface> => {
  const now = new Date();
  const signingKey = "ewhk_" + md5(randomUUID()).substr(0, 32);

  const doc = await EventWebHookModel.create({
    id: `ewh-${randomUUID()}`,
    organizationId,
    name,
    dateCreated: now,
    dateUpdated: now,
    enabled,
    events,
    url,
    signingKey,
    lastRunAt: null,
    lastState: "none",
    lastResponseBody: null,
  });

  return toInterface(doc);
};

/**
 * Retrieve an EventWebHook by ID
 * @param eventWebHookId
 * @param organizationId
 */
export const getEventWebHookById = async (
  eventWebHookId: string,
  organizationId: string
): Promise<EventWebHookInterface | null> => {
  try {
    const doc = await EventWebHookModel.findOne({
      id: eventWebHookId,
      organizationId,
    });
    return !doc ? null : toInterface(doc);
  } catch (e) {
    logger.error(e, "getEventWebHookById");
    return null;
  }
};

/**
 * Given an EventWebHook.id will delete the corresponding document
 * @param options DeleteEventWebHookParams
 */
type DeleteEventWebHookParams = {
  eventWebHookId: string;
  organizationId: string;
};
export const deleteEventWebHookById = async ({
  eventWebHookId,
  organizationId,
}: DeleteEventWebHookParams): Promise<boolean> => {
  const result = await EventWebHookModel.deleteOne({
    id: eventWebHookId,
    organizationId,
  });

  return result.deletedCount === 1;
};

type UpdateEventWebHookAttributes = {
  name?: string;
  url?: string;
  events?: NotificationEventName[];
};

/**
 * Given an EventWebHook.id allows updating some of the properties on the document
 * @param options UpdateEventWebHookQueryOptions
 * @param updates UpdateEventWebHookAttributes
 */
type UpdateEventWebHookQueryOptions = {
  eventWebHookId: string;
  organizationId: string;
};
export const updateEventWebHook = async (
  { eventWebHookId, organizationId }: UpdateEventWebHookQueryOptions,
  updates: UpdateEventWebHookAttributes
): Promise<boolean> => {
  const result = await EventWebHookModel.updateOne(
    { id: eventWebHookId, organizationId },
    {
      $set: {
        ...updates,
        dateUpdated: new Date(),
      },
    }
  );

  return result.nModified === 1;
};

type EventWebHookStatusUpdate =
  | {
      state: "success";
      responseBody: string | null;
    }
  | {
      state: "error";
      error: string;
    };

export const updateEventWebHookStatus = async (
  eventWebHookId: string,
  status: EventWebHookStatusUpdate
) => {
  const lastResponseBody =
    status.state === "success" ? status.responseBody : status.error;
  await EventWebHookModel.updateOne(
    { id: eventWebHookId },
    {
      $set: {
        lastRunAt: new Date(),
        lastState: status.state,
        lastResponseBody,
      },
    }
  );
};

/**
 * Retrieve all the event web hooks for an organization.
 * @param organizationId
 * @returns
 */
export const getAllEventWebHooks = async (
  organizationId: string
): Promise<EventWebHookInterface[]> => {
  const docs = await EventWebHookModel.find({ organizationId }).sort([
    ["dateCreated", -1],
  ]);

  return docs.map(toInterface);
};

/**
 * Retrieve all event web hooks for an organization for a given event
 * @param organizationId
 * @param eventName
 * @param enabled
 */
export const getAllEventWebHooksForEvent = async (
  organizationId: string,
  eventName: NotificationEventName,
  enabled: boolean
): Promise<EventWebHookInterface[]> => {
  const docs = await EventWebHookModel.find({
    organizationId,
    events: eventName,
    enabled,
  });

  return docs.map(toInterface);
};
