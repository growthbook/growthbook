import { randomUUID } from "node:crypto";
import { z } from "zod";
import omit from "lodash/omit";
import mongoose from "mongoose";
import { Binary } from "mongodb";
import { isEqual } from "lodash";
import {
  NotificationEventResource,
  NotificationEvents,
  ResourceEvents,
  NotificationEventPayloadSchemaType,
  NotificationEventPayloadDataType,
  NotificationEventPayloadExtraAttributes,
  NotificationEventPayload,
} from "shared/types/events/base-types";
import {
  zodNotificationEventNamesEnum,
  zodNotificationEventResources,
  eventData,
} from "shared/validators";
import { EventInterface, BaseEventInterface } from "shared/types/events/event";
import { DiffResult } from "shared/types/events/diff";
import { errorStringFromZodResult } from "back-end/src/util/validation";
import { logger } from "back-end/src/util/logger";
import {
  compressLargeText,
  decompressText,
} from "back-end/src/util/compression";
import { ReqContext } from "back-end/types/request";
import { EventNotifier } from "back-end/src/events/notifiers/EventNotifier";

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
    type: Number,
    required: false,
    enum: [MODEL_VERSION],
  },
  data: {
    type: Object,
    required: false,
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
  // Replaces `data` for large payloads: brotli-compressed JSON.
  compressedData: {
    type: Buffer,
    required: false,
  },
});

eventSchema.index({ organizationId: 1, dateCreated: -1 });

type EventDocument<T, V> = mongoose.Document & BaseEventInterface<T, V>;

// Dates are tagged so they come back as Dates, like an uncompressed read
// (an invalid Date becomes null here and epoch on read, as Mongo stores it).
const stringifyData = (data: unknown): string =>
  JSON.stringify(
    data,
    function (this: Record<string, unknown>, key: string, value: unknown) {
      const raw = this[key];
      return raw instanceof Date ? { $date: raw.getTime() } : value;
    },
  );

const readCompressedData = (stored: Buffer | Binary): unknown =>
  JSON.parse(decompressText(stored), (key, value: unknown) =>
    value !== null &&
    typeof value === "object" &&
    "$date" in value &&
    (typeof value.$date === "number" || value.$date === null) &&
    Object.keys(value).length === 1
      ? new Date(value.$date ?? 0)
      : value,
  );

/**
 * Convert the Mongo document to an EventInterface, omitting Mongo default fields __v, _id
 * @param doc
 * @returns
 */
const toInterface = <T, V>(
  doc: EventDocument<T, V>,
): BaseEventInterface<T, V> => {
  const event = omit(
    doc.toJSON<BaseEventInterface<T, V>>({ flattenMaps: true }),
    ["__v", "_id", "compressedData"],
  ) as BaseEventInterface<T, V>;
  const compressed: unknown = doc.get("compressedData");
  return Buffer.isBuffer(compressed)
    ? { ...event, data: readCompressedData(compressed) as T }
    : event;
};

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
  notify = true,
}: {
  payload: Omit<
    NotificationEventPayload<Resource, Event>,
    "api_version" | "created"
  >;
  organizationId: string;
  objectId?: string;
  // Save event history even when webhook and legacy Slack dispatch is skipped.
  notify?: boolean;
}) => {
  // Set once saved, so a failed dispatch still reports the event as created
  let savedEventId: string | null = null;
  try {
    const eventId = `event-${randomUUID()}`;

    const doc = new EventModel({
      id: eventId,
      version: MODEL_VERSION,
      event: payload.event,
      object: payload.object,
      dateCreated: new Date(),
      organizationId,
      data: { ...payload, api_version: API_VERSION, created: Date.now() },
      ...(objectId ? { objectId } : {}),
    });

    // A large JSON feature repeats its value ~20 times per event, which Mongo's
    // own compression can't see. toObject() minimizes like a save does, so
    // reads return the same data either way.
    const compressedData = await compressLargeText(
      stringifyData(doc.toObject().data),
    );
    if (compressedData) {
      await doc.validate(["data"]);
      doc.set({ data: undefined, compressedData });
    }
    await EventModel.create(doc);
    savedEventId = eventId;

    if (notify) await new EventNotifier(eventId).perform();

    // Returned so callers that record having announced something can tell a
    // swallowed failure from a delivered event.
    return eventId;
  } catch (e) {
    logger.error(e);
  }
  return savedEventId;
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
  notify?: boolean;
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
  notify = true,
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
      user: context.auditUser ?? { type: "system" },
    },
    organizationId: context.org.id,
    notify,
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
 * Stream all events for an organization, newest first, as plain objects
 */
export async function* getEventsCursorForOrganization(
  organizationId: string,
): AsyncGenerator<EventInterface> {
  const cursor = EventModel.find({ organizationId }, { _id: 0, __v: 0 })
    .sort([["dateCreated", -1]])
    .lean()
    .cursor();
  for await (const doc of cursor) {
    // Mongoose 6 doesn't carry lean typing through cursor().
    const { compressedData, ...event } = doc as unknown as EventInterface & {
      compressedData?: Binary;
    };
    yield compressedData
      ? ({
          ...event,
          data: readCompressedData(compressedData),
        } as EventInterface)
      : event;
  }
}
