import { randomUUID } from "node:crypto";
import z from "zod";
import omit from "lodash/omit";
import mongoose from "mongoose";
import {
  notificationEventNames,
  notificationEventResources,
} from "../events/base-types";
import { EventInterface } from "../../types/event";
import { errorStringFromZodResult } from "../util/validation";
import { logger } from "../util/logger";
import { NotificationEvent } from "../events/base-events";

const eventSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
    required: true,
  },
  dateCreated: Date,
  organizationId: {
    type: String,
    required: true,
  },
  object: {
    type: String,
    required: true,
    enum: notificationEventResources,
  },
  event: {
    type: String,
    required: true,
    enum: notificationEventNames,
  },
  data: {
    type: Object,
    required: true,
    validate: {
      validator(value: unknown) {
        // NotificationEventPayload<EventName, ResourceType, DataType>
        const zodSchema = z
          .object({
            event: z.enum(notificationEventNames),
            object: z.enum(notificationEventResources),
            data: z.any(),
          })
          .strict();

        const result = zodSchema.safeParse(value);

        if (!result.success) {
          const errorString = errorStringFromZodResult(result);
          logger.error(errorString, "Invalid Event data");
        }

        return result.success;
      },
      message:
        "Data is invalid. Must be of type NotificationEventPayload<NotificationEventName, NotificationEventResource, any>",
    },
  },
});

eventSchema.index({ organizationId: 1, dateCreated: -1 });

type EventDocument<T> = mongoose.Document & EventInterface<T>;

/**
 * Convert the Mongo document to an EventInterface, omitting Mongo default fields __v, _id
 * @param doc
 * @returns
 */
const toInterface = <T>(doc: EventDocument<T>): EventInterface<T> =>
  omit(doc.toJSON(), ["__v", "_id"]) as EventInterface<T>;

const EventModel = mongoose.model<EventDocument<unknown>>("Event", eventSchema);

/**
 * Create an event under an organization.
 *
 * @param organizationId
 * @param data
 * @throws Error when validation fails
 * @returns
 */
export const createEvent = async (
  organizationId: string,
  data: NotificationEvent
): Promise<EventInterface<NotificationEvent>> => {
  const eventId = `event-${randomUUID()}`;
  const doc = await EventModel.create({
    id: eventId,
    event: data.event,
    object: data.object,
    dateCreated: new Date(),
    organizationId,
    data: data,
  });

  return toInterface(doc) as EventInterface<NotificationEvent>;
};

/**
 * Get an event by ID
 * @param eventId
 */
export const getEvent = async (
  eventId: string
): Promise<EventInterface<NotificationEvent> | null> => {
  const doc = await EventModel.findOne({ id: eventId });
  return !doc ? null : (toInterface(doc) as EventInterface<NotificationEvent>);
};

/**
 * Get an event by ID for an organization
 * @param eventId
 * @param organizationId
 */
export const getEventForOrganization = async (
  eventId: string,
  organizationId: string
): Promise<EventInterface<NotificationEvent> | null> => {
  const doc = await EventModel.findOne({ id: eventId, organizationId });
  return !doc ? null : (toInterface(doc) as EventInterface<NotificationEvent>);
};

/**
 * Get all events for an organization
 * @param organizationId
 * @param limit
 * @returns
 */
export const getLatestEventsForOrganization = async (
  organizationId: string,
  limit: number = 50
): Promise<EventInterface<unknown>[]> => {
  const docs = await EventModel.find({ organizationId })
    .sort([["dateCreated", -1]])
    .limit(limit);

  return docs.map(toInterface);
};
