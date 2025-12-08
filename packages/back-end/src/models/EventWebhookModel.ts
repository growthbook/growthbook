import { randomUUID } from "crypto";
import { z } from "zod";
import omit from "lodash/omit";
import md5 from "md5";
import mongoose from "mongoose";
import intersection from "lodash/intersection";
import { NotificationEventName } from "back-end/types/events/base-types";
import { zodNotificationEventNamesEnum } from "back-end/src/validators/events";
import { errorStringFromZodResult } from "back-end/src/util/validation";
import { EventWebHookInterface } from "back-end/types/event-webhook";
import { logger } from "back-end/src/util/logger";
import {
  eventWebHookPayloadTypes,
  EventWebHookPayloadType,
  eventWebHookMethods,
  EventWebHookMethod,
} from "back-end/src/validators/event-webhook";
import { ReqContext } from "back-end/types/request";
import { createEvent } from "./EventModel";

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
  headers: {
    type: Map,
    of: String,
    required: false,
  },
  method: {
    type: String,
    required: false,
    validate: {
      validator(value: unknown) {
        const zodSchema = z.enum(eventWebHookMethods);

        const result = zodSchema.safeParse(value);

        if (!result.success) {
          const errorString = errorStringFromZodResult(result);
          logger.error(
            {
              error: JSON.stringify(errorString, null, 2),
              result: JSON.stringify(result, null, 2),
            },
            "Invalid Method",
          );
        }

        return result.success;
      },
    },
  },
  payloadType: {
    type: String,
    required: false,
    validate: {
      validator(value: unknown) {
        const zodSchema = z.enum(eventWebHookPayloadTypes);

        const result = zodSchema.safeParse(value);

        if (!result.success) {
          const errorString = errorStringFromZodResult(result);
          logger.error(
            {
              error: JSON.stringify(errorString, null, 2),
              result: JSON.stringify(result, null, 2),
            },
            "Invalid Payload Type",
          );
        }

        return result.success;
      },
    },
  },
  projects: {
    type: [String],
    required: false,
  },
  tags: {
    type: [String],
    required: false,
  },
  environments: {
    type: [String],
    required: false,
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
        const zodSchema = z.array(z.enum(zodNotificationEventNamesEnum)).min(1);

        const result = zodSchema.safeParse(value);

        if (!result.success) {
          const errorString = errorStringFromZodResult(result);
          logger.error(
            {
              error: JSON.stringify(errorString, null, 2),
              result: JSON.stringify(result, null, 2),
            },
            "Invalid Event name",
          );
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
const toInterface = (doc: EventWebHookDocument): EventWebHookInterface => {
  const payload = omit(doc.toJSON<EventWebHookDocument>(), ["__v", "_id"]);

  // Add defaults values
  const defaults = {
    ...(payload.method ? {} : { method: "POST" }),
    // All webhook are created with a payloadType. This is here for antiquated ones
    // which don't have one and should be considered raw.
    ...(payload.payloadType ? {} : { payloadType: "raw" }),
    ...(payload.headers ? {} : { headers: {} }),
    ...(payload.tags ? {} : { tags: [] }),
    ...(payload.projects ? {} : { projects: [] }),
    ...(payload.environments ? {} : { environments: [] }),
  };

  if (Object.keys(defaults).length)
    void (async () => {
      try {
        EventWebHookModel.updateOne(
          { id: doc.id },
          {
            $set: defaults,
          },
        );
      } catch (_) {
        return;
      }
    })();

  return {
    ...defaults,
    ...payload,
  };
};

export const EventWebHookModel = mongoose.model<EventWebHookInterface>(
  "EventWebHook",
  eventWebHookSchema,
);

type CreateEventWebHookOptions = {
  name: string;
  url: string;
  organizationId: string;
  enabled: boolean;
  events: NotificationEventName[];
  projects: string[];
  tags: string[];
  environments: string[];
  payloadType: EventWebHookPayloadType;
  method: EventWebHookMethod;
  headers: Record<string, string>;
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
  projects,
  tags,
  environments,
  payloadType,
  method,
  headers,
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
    projects,
    tags,
    environments,
    payloadType,
    method,
    headers,
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
  organizationId: string,
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

/**
 * Given an EventWebHook.organizationId will delete the all corresponding document
 * @param organizationId organization ID
 */
export const deleteOrganizationventWebHook = async (
  organizationId: string,
): Promise<boolean> => {
  const result = await EventWebHookModel.deleteMany({
    organizationId,
  });

  return result.deletedCount > 0;
};

export type UpdateEventWebHookAttributes = {
  name?: string;
  url?: string;
  enabled?: boolean;
  events?: NotificationEventName[];
  tags?: string[];
  environments?: string[];
  projects?: string[];
  payloadType?: EventWebHookPayloadType;
  method?: EventWebHookMethod;
  headers?: Record<string, string>;
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
  updates: UpdateEventWebHookAttributes,
): Promise<boolean> => {
  const result = await EventWebHookModel.updateOne(
    { id: eventWebHookId, organizationId },
    {
      $set: {
        ...updates,
        dateUpdated: new Date(),
      },
    },
  );

  return result.modifiedCount === 1;
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
  status: EventWebHookStatusUpdate,
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
    },
  );
};

/**
 * Retrieve all the event web hooks for an organization.
 * @param organizationId
 * @returns
 */
export const getAllEventWebHooks = async (
  organizationId: string,
): Promise<EventWebHookInterface[]> => {
  const docs = await EventWebHookModel.find({ organizationId }).sort([
    ["dateCreated", -1],
  ]);

  return docs.map(toInterface);
};

const filterOptional = <T>(want: T[] = [], has: T[]) => {
  if (!want.length) return true;
  return !!intersection(want, has).length;
};

/**
 * Retrieve all event web hooks for an organization for a given event
 * @param organizationId
 * @param eventName
 * @param enabled
 */
export const getAllEventWebHooksForEvent = async ({
  organizationId,
  eventName,
  enabled,
  tags,
  projects,
}: {
  organizationId: string;
  eventName: NotificationEventName;
  enabled: boolean;
  tags: string[];
  projects: string[];
}): Promise<EventWebHookInterface[]> => {
  const allDocs = await EventWebHookModel.find({
    organizationId,
    events: eventName,
    enabled,
  });

  const docs = allDocs.filter((doc) => {
    if (!filterOptional(doc.tags, tags)) return false;
    if (!filterOptional(doc.projects, projects)) return false;

    return true;
  });

  return docs.map(toInterface);
};

export const sendEventWebhookTestEvent = async (
  context: ReqContext,
  webhookId: string,
) => {
  if (!context.permissions.canCreateEventWebhook()) {
    context.permissions.throwPermissionError();
  }

  const webhook = await getEventWebHookById(webhookId, context.org.id);

  if (!webhook) throw new Error(`Cannot find webhook with id ${webhookId}`);

  await createEvent({
    context,
    object: "webhook",
    objectId: webhook.id,
    event: "test",
    data: { object: { webhookId: webhook.id } },
    containsSecrets: false,
    projects: [],
    tags: [],
    environments: [],
  });
};
