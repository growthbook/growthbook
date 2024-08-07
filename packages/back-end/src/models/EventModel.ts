import { randomUUID } from "node:crypto";
import z from "zod";
import omit from "lodash/omit";
import mongoose from "mongoose";
import {
  zodNotificationEventNamesEnum,
  notificationEventResources,
} from "../events/base-types";
import { EventInterface } from "../../types/event";
import { errorStringFromZodResult } from "../util/validation";
import { logger } from "../util/logger";
import { NotificationEvent } from "../events/notification-events";

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
    enum: zodNotificationEventNamesEnum,
  },
  data: {
    type: Object,
    required: true,
    validate: {
      validator(value: unknown) {
        // NotificationEventPayload<EventName, ResourceType, DataType>
        const zodSchema = z
          .object({
            event: z.enum(zodNotificationEventNamesEnum),
            object: z.enum(notificationEventResources),
            data: z.any(),
            projects: z.array(z.string()),
            environments: z.array(z.string()),
            tags: z.array(z.string()),
            containsSecrets: z.boolean(),
            user: z.union([
              z
                .object({
                  type: z.literal("dashboard"),
                  id: z.string(),
                  email: z.string(),
                  name: z.string(),
                })
                .strict(),
              z
                .object({
                  type: z.literal("api_key"),
                  apiKey: z.string(),
                })
                .strict(),
              z.null(),
            ]),
          })
          .strict();

        const result = zodSchema.safeParse(value);

        if (!result.success) {
          const errorString = errorStringFromZodResult(result);
          logger.error(
            {
              error: JSON.stringify(errorString, null, 2),
              result: JSON.stringify(result, null, 2),
            },
            "Invalid Event data"
          );
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
  omit(
    doc.toJSON<EventInterface<T>>({ flattenMaps: true }),
    ["__v", "_id"]
  ) as EventInterface<T>;

const EventModel = mongoose.model<EventInterface<unknown>>(
  "Event",
  eventSchema
);

/**
 * Create an event under an organization.
 *
 * @param organizationId
 * @param data
 * @returns
 */
export const createEvent = async (
  organizationId: string,
  data: NotificationEvent
): Promise<EventInterface<NotificationEvent> | null> => {
  try {
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
  } catch (e) {
    logger.error(e);
    return null;
  }
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
 * Get all events for an organization, and allow for pagination
 * @param organizationId
 * @param filters - object containing: page, perPage, eventTypes, from, to, sortOrder
 * @returns
 */
export const getEventsForOrganization = async (
  organizationId: string,
  filters: {
    page: number;
    perPage: number;
    eventTypes?: string[];
    from?: string;
    to?: string;
    sortOrder?: 1 | -1;
  }
): Promise<EventInterface<unknown>[]> => {
  const query = applyFiltersToQuery(organizationId, filters);
  const docs = await EventModel.find(query)
    .sort([["dateCreated", filters.sortOrder ?? -1]])
    .skip((filters.page - 1) * filters.perPage)
    .limit(filters.perPage);

  return docs.map(toInterface);
};

/**
 * Get the total count of events for an organization
 * @param organizationId
 * @param filters - object containing: eventTypes, from, to
 * @returns
 */
export const getEventsCountForOrganization = async (
  organizationId: string,
  filters: {
    eventTypes?: string[];
    from?: string;
    to?: string;
  }
): Promise<number> => {
  const query = applyFiltersToQuery(organizationId, filters);
  return EventModel.countDocuments(query);
};

const applyFiltersToQuery = (
  organizationId: string,
  filters: { eventTypes?: string[]; from?: string; to?: string }
) => {
  const query: {
    organizationId: string;
    event?: unknown;
    dateCreated?: unknown;
  } = { organizationId };
  if (filters.eventTypes && filters.eventTypes.length > 0) {
    query["event"] = { $in: filters.eventTypes };
  }
  if (filters.from && filters.to) {
    query["dateCreated"] = {
      $gte: new Date(filters.from),
      $lt: new Date(filters.to),
    };
  } else if (filters.from) {
    query["dateCreated"] = { $gte: new Date(filters.from) };
  } else if (filters.to) {
    query["dateCreated"] = { $lt: new Date(filters.to) };
  }

  return query;
};

/**
 * Get all events for an organization
 * @param organizationId
 * @param limit  Providing 0 as a limit will return all events
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
