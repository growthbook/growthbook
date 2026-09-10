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
  slackDigestNextRunAts,
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
    teamId: String,
    channelName: String,
    channelId: String,
    configurationUrl: String,
  },
  slackOptions: { type: mongoose.Schema.Types.Mixed, required: false },
  nextExperimentDigestAt: { type: Date, required: false },
  nextFeatureDigestAt: { type: Date, required: false },
  experimentDigestLeaseUntil: { type: Date, required: false },
  featureDigestLeaseUntil: { type: Date, required: false },
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
});

eventWebHookSchema.index({ organizationId: 1 });
eventWebHookSchema.index({ payloadType: 1, nextExperimentDigestAt: 1 });
eventWebHookSchema.index({ payloadType: 1, nextFeatureDigestAt: 1 });

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
  id?: string;
  name: string;
  url: string;
  organizationId: string;
  enabled: boolean;
  events: NotificationEventNameOrWildcard[];
  projects: string[];
  tags: string[];
  environments: string[];
  payloadType: EventWebHookPayloadType;
  method: EventWebHookMethod;
  headers: Record<string, string>;
  slack?: EventWebHookInterface["slack"];
  slackOptions?: EventWebHookInterface["slackOptions"];
};

/**
 * Create an event web hook for an organization for the given events
 * @param options CreateEventWebHookOptions
 * @returns Promise<EventWebHookInterface>
 */
export const createEventWebHook = async ({
  id,
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
  slack,
  slackOptions,
}: CreateEventWebHookOptions): Promise<EventWebHookInterface> => {
  const now = new Date();
  const signingKey = "ewhk_" + md5(randomUUID()).substr(0, 32);

  const doc = await EventWebHookModel.create({
    id: id || `ewh-${randomUUID()}`,
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
    slack,
    slackOptions,
    lastRunAt: null,
    lastState: "none",
    lastResponseBody: null,
    ...(() => {
      const next = slackDigestNextRunAts(slackOptions, now);
      return {
        ...(next.experiment ? { nextExperimentDigestAt: next.experiment } : {}),
        ...(next.feature ? { nextFeatureDigestAt: next.feature } : {}),
      };
    })(),
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
  payloadType?: EventWebHookPayloadType;
  method?: EventWebHookMethod;
  headers?: Record<string, string>;
  slack?: EventWebHookInterface["slack"];
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
  const result = await EventWebHookModel.updateOne(
    { id: eventWebHookId, organizationId },
    {
      $set: {
        ...updates,
        dateUpdated: new Date(),
      },
    },
  );

  if (updates.slackOptions !== undefined) {
    await syncSlackDigestSchedule({
      eventWebHookId,
      organizationId,
      slackOptions: updates.slackOptions,
    });
  }

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

export type SlackDigestKind = "experiment" | "feature";
const DIGEST_FIELD: Record<SlackDigestKind, string> = {
  experiment: "nextExperimentDigestAt",
  feature: "nextFeatureDigestAt",
};
const DIGEST_LEASE_FIELD: Record<SlackDigestKind, string> = {
  experiment: "experimentDigestLeaseUntil",
  feature: "featureDigestLeaseUntil",
};

export const syncSlackDigestSchedule = async ({
  eventWebHookId,
  organizationId,
  slackOptions,
  from = new Date(),
}: {
  eventWebHookId: string;
  organizationId: string;
  slackOptions: EventWebHookInterface["slackOptions"];
  from?: Date;
}) => {
  const next = slackDigestNextRunAts(slackOptions, from);
  const set: Record<string, Date> = {};
  const unset: Record<string, ""> = {};
  (["experiment", "feature"] as SlackDigestKind[]).forEach((kind) => {
    const field = DIGEST_FIELD[kind];
    if (next[kind]) set[field] = next[kind] as Date;
    else unset[field] = "";
  });
  await EventWebHookModel.updateOne(
    { id: eventWebHookId, organizationId },
    {
      ...(Object.keys(set).length ? { $set: set } : {}),
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
    },
  );
};

export const getSlackWebhooksWithDigestDue = async (now: Date) => {
  const docs = await EventWebHookModel.find({
    enabled: true,
    payloadType: "slack",
    $or: [
      { nextExperimentDigestAt: { $lte: now } },
      { nextFeatureDigestAt: { $lte: now } },
    ],
  });
  return docs.map(toInterface);
};

export const getSlackWebhooksMissingDigestSchedule = async () => {
  const docs = await EventWebHookModel.find({
    enabled: true,
    payloadType: "slack",
    $or: [
      { nextExperimentDigestAt: { $exists: false } },
      { nextFeatureDigestAt: { $exists: false } },
    ],
  }).limit(500);
  return docs.map(toInterface);
};

export const claimSlackDigestRun = async ({
  eventWebHookId,
  organizationId,
  kind,
  now,
}: {
  eventWebHookId: string;
  organizationId: string;
  kind: SlackDigestKind;
  now: Date;
}) => {
  const field = DIGEST_FIELD[kind];
  const leaseField = DIGEST_LEASE_FIELD[kind];
  const leaseUntil = new Date(now.getTime() + 10 * 60 * 1000);
  const result = await EventWebHookModel.updateOne(
    {
      id: eventWebHookId,
      organizationId,
      [field]: { $lte: now },
      $or: [
        { [leaseField]: { $exists: false } },
        { [leaseField]: { $lte: now } },
      ],
    },
    { $set: { [leaseField]: leaseUntil } },
  );
  return result.modifiedCount === 1 ? { leaseUntil } : null;
};

export const completeSlackDigestRun = async ({
  eventWebHookId,
  organizationId,
  kind,
  leaseUntil,
  nextRunAt,
}: {
  eventWebHookId: string;
  organizationId: string;
  kind: SlackDigestKind;
  leaseUntil: Date;
  nextRunAt: Date | null;
}) => {
  const field = DIGEST_FIELD[kind];
  const leaseField = DIGEST_LEASE_FIELD[kind];
  await EventWebHookModel.updateOne(
    { id: eventWebHookId, organizationId, [leaseField]: leaseUntil },
    nextRunAt
      ? { $set: { [field]: nextRunAt }, $unset: { [leaseField]: "" } }
      : { $unset: { [field]: "", [leaseField]: "" } },
  );
};

export const releaseSlackDigestRun = async ({
  eventWebHookId,
  organizationId,
  kind,
  leaseUntil,
}: {
  eventWebHookId: string;
  organizationId: string;
  kind: SlackDigestKind;
  leaseUntil: Date;
}) => {
  const leaseField = DIGEST_LEASE_FIELD[kind];
  await EventWebHookModel.updateOne(
    { id: eventWebHookId, organizationId, [leaseField]: leaseUntil },
    { $unset: { [leaseField]: "" } },
  );
};

export const findSlackChannelEventWebhook = async ({
  organizationId,
  teamId,
  channelId,
}: {
  organizationId: string;
  teamId: string;
  channelId: string;
}): Promise<EventWebHookInterface | null> => {
  const doc = await EventWebHookModel.findOne({
    organizationId,
    payloadType: "slack",
    "slack.teamId": teamId,
    "slack.channelId": channelId,
  });
  return doc ? toInterface(doc) : null;
};

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

export const reconnectSlackEventWebhook = async ({
  eventWebHookId,
  organizationId,
  url,
  slack,
  enabled,
}: {
  eventWebHookId: string;
  organizationId: string;
  url?: string;
  slack: NonNullable<EventWebHookInterface["slack"]>;
  enabled?: boolean;
}): Promise<void> => {
  const set: Record<string, unknown> = {
    ...(url ? { url } : {}),
    ...(enabled !== undefined ? { enabled } : {}),
    dateUpdated: new Date(),
  };
  for (const [key, value] of Object.entries(slack)) {
    if (value !== undefined) set[`slack.${key}`] = value;
  }
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
}: {
  organizationId: string;
  eventName: NotificationEventName;
  enabled: boolean;
  tags: string[];
  projects: string[];
}): Promise<EventWebHookInterface[]> => {
  const allDocs = await EventWebHookModel.find({
    organizationId,
    events: { $in: [eventName, ...getWildcardPatternsForEvent(eventName)] },
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
