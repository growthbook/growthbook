import { randomUUID } from "node:crypto";
import { z } from "zod";
import omit from "lodash/omit";
import mongoose from "mongoose";
import { isEqual } from "lodash";
import {
  NotificationEventResource,
  NotificationEvents,
  ResourceEvents,
  NotificationEventPayloadSchemaType,
  NotificationEventPayloadDataType,
  NotificationEventPayloadExtraAttributes,
  NotificationEventPayload,
} from "back-end/types/events/base-types";
import {
  zodNotificationEventNamesEnum,
  zodNotificationEventResources,
  eventData,
} from "back-end/src/validators/events";
import {
  EventInterface,
  BaseEventInterface,
} from "back-end/types/events/event";
import { errorStringFromZodResult } from "back-end/src/util/validation";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";
import { EventNotifier } from "back-end/src/events/notifiers/EventNotifier";
import { DiffResult } from "back-end/types/events/diff";

const API_VERSION = "2024-07-31" as const;
const MODEL_VERSION = 1 as const;

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
    enum: zodNotificationEventResources,
  },
  objectId: {
    type: String,
    required: false,
  },
  event: {
    type: String,
    required: true,
    enum: zodNotificationEventNamesEnum,
  },
  version: {
    type: String,
    required: false,
    enum: ["1"],
  },
  data: {
    type: Object,
    required: true,
    validate: {
      validator(value: unknown) {
        const result = eventData(z.any()).safeParse(value);

        if (!result.success) {
          const errorString = errorStringFromZodResult(result);
          logger.error(
            {
              error: JSON.stringify(errorString, null, 2),
              result: JSON.stringify(result, null, 2),
            },
            "Invalid Event data",
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

type EventDocument<T, V> = mongoose.Document & BaseEventInterface<T, V>;

/**
 * Convert the Mongo document to an EventInterface, omitting Mongo default fields __v, _id
 * @param doc
 * @returns
 */
const toInterface = <T, V>(
  doc: EventDocument<T, V>,
): BaseEventInterface<T, V> =>
  omit(doc.toJSON<BaseEventInterface<T, V>>({ flattenMaps: true }), [
    "__v",
    "_id",
  ]) as BaseEventInterface<T, V>;

export const EventModel = mongoose.model<BaseEventInterface<unknown, unknown>>(
  "Event",
  eventSchema,
);

export const createEventWithPayload = async <
  Resource extends NotificationEventResource,
  Event extends ResourceEvents<Resource>,
>({
  payload,
  organizationId,
  objectId,
}: {
  payload: Omit<
    NotificationEventPayload<Resource, Event>,
    "api_version" | "created"
  >;
  organizationId: string;
  objectId?: string;
}) => {
  try {
    const eventId = `event-${randomUUID()}`;

    const doc = await EventModel.create({
      id: eventId,
      version: MODEL_VERSION,
      event: payload.event,
      object: payload.object,
      dateCreated: new Date(),
      organizationId,
      data: { ...payload, api_version: API_VERSION, created: Date.now() },
      ...(objectId ? { objectId } : {}),
    });

    const event = toInterface(doc) as BaseEventInterface<
      NotificationEventPayload<Resource, Event>,
      typeof MODEL_VERSION
    >;

    new EventNotifier(event.id).perform();
  } catch (e) {
    logger.error(e);
  }
};

// createEvent can handle creating the diff

export type CreateEventData<
  Resource extends NotificationEventResource,
  Event extends ResourceEvents<Resource>,
  Payload = NotificationEventPayloadSchemaType<Resource, Event>,
> = NotificationEvents[Resource][Event] extends {
  isDiff: true;
}
  ? {
      object: Payload;
      previous_object: Payload;
      changes?: DiffResult;
    } & NotificationEventPayloadExtraAttributes<Resource, Event>
  : { object: Payload } & NotificationEventPayloadExtraAttributes<
      Resource,
      Event
    >;

export const hasPreviousObject = <
  Resource extends NotificationEventResource,
  Event extends ResourceEvents<Resource>,
  Payload = NotificationEventPayloadSchemaType<Resource, Event>,
>(
  data: CreateEventData<Resource, Event, Payload>,
): data is {
  object: Payload;
  previous_object: Payload;
} & NotificationEventPayloadExtraAttributes<Resource, Event> =>
  Object.keys(data).includes("previous_object");

const diffData = <
  Resource extends NotificationEventResource,
  Event extends ResourceEvents<Resource>,
  Payload = NotificationEventPayloadSchemaType<Resource, Event>,
>(
  data: CreateEventData<Resource, Event, Payload>,
): NotificationEventPayloadDataType<Resource, Event, Payload> => {
  if (!hasPreviousObject(data))
    return data as unknown as NotificationEventPayloadDataType<
      Resource,
      Event,
      Payload
    >;

  const { object, previous_object, changes, ...remainingData } = data as {
    object: Record<string, unknown>;
    previous_object: Record<string, unknown>;
    changes?: DiffResult;
  };

  return {
    ...remainingData,
    object,
    previous_attributes: [
      ...new Set([
        ...Object.keys(object),
        ...Object.keys(previous_object as object),
      ]),
    ].reduce(
      (diff, key) => ({
        ...diff,
        ...(isEqual(object[key], previous_object[key])
          ? {}
          : { [key]: previous_object[key] }),
      }),
      {},
    ),
    changes,
  } as unknown as NotificationEventPayloadDataType<Resource, Event, Payload>;
};

export type CreateEventParams<
  Resource extends NotificationEventResource,
  Event extends ResourceEvents<Resource>,
  Payload = NotificationEventPayloadSchemaType<Resource, Event>,
> = {
  context: ReqContext;
  object: Resource;
  objectId?: string;
  event: Event;
  data: CreateEventData<Resource, Event, Payload>;
  containsSecrets: boolean;
  projects: string[];
  tags: string[];
  environments: string[];
};

export const createEvent = async <
  Resource extends NotificationEventResource,
  Event extends ResourceEvents<Resource>,
>({
  context,
  object,
  objectId,
  event,
  data,
  containsSecrets,
  projects,
  tags,
  environments,
}: CreateEventParams<Resource, Event>) =>
  createEventWithPayload<Resource, Event>({
    payload: {
      event: `${object}.${event}`,
      object,
      data: diffData(data),
      projects,
      tags,
      environments,
      containsSecrets,
      user: context.userId
        ? {
            type: "dashboard",
            id: context.userId,
            email: context.email,
            name: context.userName || "",
          }
        : context.apiKey
          ? {
              type: "api_key",
              apiKey: context.apiKey,
            }
          : {
              type: "system",
            },
    },
    organizationId: context.org.id,
    ...(objectId ? { objectId } : {}),
  });

/**
 * Get an event by ID
 * @param eventId
 */
export const getEvent = async (
  eventId: string,
): Promise<EventInterface | null> => {
  const doc = await EventModel.findOne({ id: eventId });
  return !doc ? null : (toInterface(doc) as EventInterface);
};

/**
 * Get an event by ID for an organization
 * @param eventId
 * @param organizationId
 */
export const getEventForOrganization = async (
  eventId: string,
  organizationId: string,
): Promise<EventInterface | null> => {
  const doc = await EventModel.findOne({ id: eventId, organizationId });
  return !doc ? null : (toInterface(doc) as EventInterface);
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
  },
): Promise<EventInterface[]> => {
  const query = applyFiltersToQuery(organizationId, filters);
  const docs = await EventModel.find(query)
    .sort([["dateCreated", filters.sortOrder ?? -1]])
    .skip((filters.page - 1) * filters.perPage)
    .limit(filters.perPage);

  return docs.map(toInterface) as EventInterface[];
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
  },
): Promise<number> => {
  const query = applyFiltersToQuery(organizationId, filters);
  return EventModel.countDocuments(query);
};

const applyFiltersToQuery = (
  organizationId: string,
  filters: { eventTypes?: string[]; from?: string; to?: string },
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
  limit: number = 50,
): Promise<EventInterface[]> => {
  const docs = await EventModel.find({ organizationId })
    .sort([["dateCreated", -1]])
    .limit(limit);

  return docs.map(toInterface) as EventInterface[];
};
