import z from "zod";
import _ from "lodash";
import mongoose from "mongoose";
import {
  NotificationEventName,
  notificationEventNames,
  NotificationEventPayload,
  NotificationEventResource,
  notificationEventResources,
} from "../events/base-types";
import { EventInterface } from "../../types/event";
import { errorStringFromZodResult } from "../util/validation";

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
  data: {
    type: Object,
    required: true,
    validate: {
      validator(value: unknown) {
        // NotificationEventPayload<EventName, ResourceType, DataType>
        const zodSchema = z
          .object({
            organization_id: z.string().optional(),
            event_id: z.string().startsWith("event-"),
            event: z.enum(notificationEventNames),
            object: z.enum(notificationEventResources),
            data: z.any(),
          })
          .strict();

        const result = zodSchema.safeParse(value);

        if (!result.success) {
          const errorString = errorStringFromZodResult(result);
          console.error("Invalid Event data ", errorString);
        }

        return result.success;
      },
      message:
        "Data is invalid. Must be of type NotificationEventPayload<NotificationEventName, NotificationEventResource, any>",
    },
  },
});

eventSchema.index({ organizationId: 1 });

type EventDocument<T> = mongoose.Document & EventInterface<T>;

/**
 * Convert the Mongo document to an EventInterface, omitting Mongo default fields __v, _id
 * @param doc
 * @returns
 */
const toInterface = <T>(doc: EventDocument<T>): EventInterface<T> =>
  _.omit(doc.toJSON(), ["__v", "_id"]) as EventInterface<T>;

const EventModel = mongoose.model<EventDocument<unknown>>("Event", eventSchema);

/**
 * Create an event under an organization.
 *
 * @param organizationId
 * @param data
 * @throws Error when validation fails
 * @returns
 */
export const createEvent = async <
  EventName extends NotificationEventName,
  ResourceType extends NotificationEventResource,
  DataType
>(
  organizationId: string,
  data: NotificationEventPayload<EventName, ResourceType, DataType>
): Promise<EventInterface<DataType>> => {
  const doc = await EventModel.create({
    id: data.event_id,
    dateCreated: new Date(),
    organizationId,
    data,
  });

  return toInterface(doc) as EventInterface<DataType>;
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
