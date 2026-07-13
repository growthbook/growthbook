import { randomUUID } from "crypto";
import { z } from "zod";
import omit from "lodash/omit";
import md5 from "md5";
import mongoose from "mongoose";
import intersection from "lodash/intersection";
import { NotificationEventName } from "shared/types/events/base-types";
import {
  zodNotificationEventNamesEnum,
  eventWebHookPayloadTypes,
  EventWebHookPayloadType,
  eventWebHookMethods,
  EventWebHookMethod,
  isEventWebhookWildcard,
  getWildcardPatternsForEvent,
  NotificationEventNameOrWildcard,
} from "shared/validators";
import { EventWebHookInterface } from "shared/types/event-webhook";
import { errorStringFromZodResult } from "back-end/src/util/validation";
import { logger } from "back-end/src/util/logger";
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
  slack: {
    appId: String,
    teamId: String,
    teamName: String,
    enterpriseId: String,
    enterpriseName: String,
    channelName: String,
    channelId: String,
    configurationUrl: String,
    botUserId: String,
    authedUserId: String,
    botAccessToken: String,
    scope: String,
    isEnterpriseInstall: Boolean,
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
  experiments: {
    type: [String],
    required: false,
  },
  metrics: {
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
        const zodSchema = z
          .array(
            z
              .string()
              .refine(
                (val) =>
                  zodNotificationEventNamesEnum.includes(val as never) ||
                  isEventWebhookWildcard(val),
              ),
          )
          .min(1);

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
  coalesceWindowMs: {
    type: Number,
    required: false,
    min: 0,
  },
  dailyDigestHourUtc: {
    type: Number,
    required: false,
    min: 0,
    max: 23,
  },
  // Slack bot options (flat keys). Stored as a free-form object so new toggles
  // don't require a schema change; validated by slackEventWebHookOptions.
  slackOptions: {
    type: Object,
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
  if (payload.slack && "botAccessToken" in payload.slack) {
    delete (payload.slack as Record<string, unknown>).botAccessToken;
  }

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
    ...(payload.experiments ? {} : { experiments: [] }),
    ...(payload.metrics ? {} : { metrics: [] }),
  };

  if (Object.keys(defaults).length)
    void (async () => {
      try {
        EventWebHookModel.updateOne(
          { id: doc.id, organizationId: doc.organizationId },
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
  events: NotificationEventNameOrWildcard[];
  projects: string[];
  experiments?: string[];
  metrics?: string[];
  tags: string[];
  environments: string[];
  payloadType: EventWebHookPayloadType;
  method: EventWebHookMethod;
  headers: Record<string, string>;
  slack?: EventWebHookInterface["slack"];
  coalesceWindowMs?: number;
  dailyDigestHourUtc?: number;
  slackOptions?: EventWebHookInterface["slackOptions"];
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
  experiments = [],
  metrics = [],
  tags,
  environments,
  payloadType,
  method,
  headers,
  slack,
  coalesceWindowMs,
  dailyDigestHourUtc,
  slackOptions,
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
    experiments,
    metrics,
    tags,
    environments,
    payloadType,
    method,
    headers,
    slack,
    lastRunAt: null,
    lastState: "none",
    lastResponseBody: null,
    ...(coalesceWindowMs !== undefined ? { coalesceWindowMs } : {}),
    ...(dailyDigestHourUtc !== undefined ? { dailyDigestHourUtc } : {}),
    ...(slackOptions !== undefined ? { slackOptions } : {}),
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
  events?: NotificationEventNameOrWildcard[];
  tags?: string[];
  environments?: string[];
  projects?: string[];
  experiments?: string[];
  metrics?: string[];
  payloadType?: EventWebHookPayloadType;
  method?: EventWebHookMethod;
  headers?: Record<string, string>;
  slack?: EventWebHookInterface["slack"];
  coalesceWindowMs?: number;
  dailyDigestHourUtc?: number | null;
  slackOptions?: EventWebHookInterface["slackOptions"];
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
  const setUpdates = { ...updates };
  const unsetUpdates: Record<string, ""> = {};

  if (updates.dailyDigestHourUtc === null) {
    delete setUpdates.dailyDigestHourUtc;
    unsetUpdates.dailyDigestHourUtc = "";
  }

  const result = await EventWebHookModel.updateOne(
    { id: eventWebHookId, organizationId },
    {
      $set: {
        ...setUpdates,
        dateUpdated: new Date(),
      },
      ...(Object.keys(unsetUpdates).length ? { $unset: unsetUpdates } : {}),
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
  organizationId: string,
  status: EventWebHookStatusUpdate,
) => {
  const lastResponseBody =
    status.state === "success" ? status.responseBody : status.error;
  await EventWebHookModel.updateOne(
    { id: eventWebHookId, organizationId },
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

export const getSlackBotAccessTokenForWebhook = async ({
  eventWebHookId,
  organizationId,
}: {
  eventWebHookId: string;
  organizationId: string;
}): Promise<string | null> => {
  const doc = await EventWebHookModel.findOne({
    id: eventWebHookId,
    organizationId,
    payloadType: "slack",
  }).lean();
  const slack = doc?.slack as { botAccessToken?: string } | undefined;
  return slack?.botAccessToken || null;
};

// Cache a freshly-resolved Slack channel name onto the install. Uses a dotted
// $set so only slack.channelName is touched (the bot token and other metadata
// are left intact).
export const updateSlackChannelName = async ({
  eventWebHookId,
  organizationId,
  channelName,
}: {
  eventWebHookId: string;
  organizationId: string;
  channelName: string;
}): Promise<void> => {
  await EventWebHookModel.updateOne(
    { id: eventWebHookId, organizationId, payloadType: "slack" },
    { $set: { "slack.channelName": channelName } },
  );
};

// Reconnect an existing Slack install: refresh the incoming-webhook url and all
// slack metadata in a SINGLE write. Metadata fields are set via dotted $set so
// slack.botAccessToken is left intact — a whole-object `$set: { slack }` would
// drop the token (it's not part of the public metadata type). When Slack
// returns a new bot token, it's set in this same write, so the token is never
// missing mid-reconnect and never permanently lost when the OAuth response
// omits one.
export const reconnectSlackEventWebhook = async ({
  eventWebHookId,
  organizationId,
  url,
  slack,
  botAccessToken,
}: {
  eventWebHookId: string;
  organizationId: string;
  url: string;
  slack: NonNullable<EventWebHookInterface["slack"]>;
  botAccessToken?: string;
}): Promise<void> => {
  const set: Record<string, unknown> = { url, dateUpdated: new Date() };
  for (const [key, value] of Object.entries(slack)) {
    if (value !== undefined) set[`slack.${key}`] = value;
  }
  if (botAccessToken) set["slack.botAccessToken"] = botAccessToken;

  await EventWebHookModel.updateOne(
    { id: eventWebHookId, organizationId, payloadType: "slack" },
    { $set: set },
  );
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
  experimentId,
  metricIds,
}: {
  organizationId: string;
  eventName: NotificationEventName;
  enabled: boolean;
  tags: string[];
  projects: string[];
  experimentId?: string;
  metricIds?: string[];
}): Promise<EventWebHookInterface[]> => {
  const allDocs = await EventWebHookModel.find({
    organizationId,
    events: { $in: [eventName, ...getWildcardPatternsForEvent(eventName)] },
    enabled,
  });

  const docs = allDocs.filter((doc) => {
    if (!filterOptional(doc.tags, tags)) return false;
    if (!filterOptional(doc.projects, projects)) return false;
    if (!filterOptional(doc.experiments, experimentId ? [experimentId] : []))
      return false;
    if (!filterOptional(doc.metrics, metricIds || [])) return false;

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
