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
  features: {
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
  // Free-form object (validated by slackEventWebHookOptions) so new toggles
  // don't require a schema change.
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
    ...(payload.features ? {} : { features: [] }),
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
  features?: string[];
  tags: string[];
  environments: string[];
  payloadType: EventWebHookPayloadType;
  method: EventWebHookMethod;
  headers: Record<string, string>;
  slack?: EventWebHookInterface["slack"];
  coalesceWindowMs?: number;
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
  features = [],
  tags,
  environments,
  payloadType,
  method,
  headers,
  slack,
  coalesceWindowMs,
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
    features,
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
  features?: string[];
  payloadType?: EventWebHookPayloadType;
  method?: EventWebHookMethod;
  headers?: Record<string, string>;
  slack?: EventWebHookInterface["slack"];
  coalesceWindowMs?: number;
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
  const slack = doc?.slack as
    | { botAccessToken?: string; teamId?: string }
    | undefined;
  if (slack?.botAccessToken) return slack.botAccessToken;

  // The bot token is workspace-level, so fall back to any same-team doc's
  // token (e.g. the workspace connection doc, or a sibling channel refreshed
  // by a more recent reconnect).
  if (!slack?.teamId) return null;
  const teamDoc = await EventWebHookModel.findOne({
    organizationId,
    payloadType: "slack",
    "slack.teamId": slack.teamId,
    "slack.botAccessToken": { $exists: true, $nin: [null, ""] },
  }).lean();
  const teamSlack = teamDoc?.slack as { botAccessToken?: string } | undefined;
  return teamSlack?.botAccessToken || null;
};

// The org's workspace-level Slack connection for a team: the channel-less doc
// created by a workspace install (channel docs are separate, one per channel).
export const findSlackWorkspaceEventWebhook = async ({
  organizationId,
  teamId,
}: {
  organizationId: string;
  teamId: string;
}): Promise<EventWebHookInterface | null> => {
  const doc = await EventWebHookModel.findOne({
    organizationId,
    payloadType: "slack",
    "slack.teamId": teamId,
    $or: [
      { "slack.channelId": { $exists: false } },
      { "slack.channelId": { $in: [null, ""] } },
    ],
  });
  return doc ? toInterface(doc) : null;
};

// Push a freshly-issued bot token and/or scope string onto every same-team doc
// in the org. Run after a workspace (re)install so channel docs — which no
// longer get their own OAuth exchange — pick up the new credentials (and their
// settings-page reconnect banner, which reads slack.scope, clears).
export const propagateSlackTeamCredentials = async ({
  organizationId,
  teamId,
  botAccessToken,
  scope,
}: {
  organizationId: string;
  teamId: string;
  botAccessToken?: string;
  scope?: string;
}): Promise<void> => {
  const set: Record<string, unknown> = {
    ...(botAccessToken ? { "slack.botAccessToken": botAccessToken } : {}),
    ...(scope ? { "slack.scope": scope } : {}),
  };
  if (!Object.keys(set).length) return;
  await EventWebHookModel.updateMany(
    { organizationId, payloadType: "slack", "slack.teamId": teamId },
    { $set: set },
  );
};

// Toggle a workspace-wide Slack option (conversational assistant, link
// unfurling). Written to every same-team doc so the flag reads consistently no
// matter which doc resolves an event (workspace connection or a legacy channel
// doc). Dotted $set leaves the bot token and all other slackOptions untouched.
export const setSlackWorkspaceFlag = async ({
  organizationId,
  teamId,
  field,
  enabled,
}: {
  organizationId: string;
  teamId: string;
  field: "assistantEnabled" | "unfurlEnabled";
  enabled: boolean;
}): Promise<void> => {
  await EventWebHookModel.updateMany(
    { organizationId, payloadType: "slack", "slack.teamId": teamId },
    { $set: { [`slackOptions.${field}`]: enabled } },
  );
};

// Dotted $set so only slack.channelName is touched (bot token and other
// metadata left intact).
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

// Reconnect an existing Slack install: refresh the url (when provided — a
// workspace reconnect has none) and slack metadata in one write. Dotted $set
// keeps slack.botAccessToken intact — a whole-object `$set: { slack }` would
// drop it (not part of the public metadata type) — and any new bot token is set
// in the same write, so the token is never missing mid-reconnect nor lost when
// the OAuth response omits one. `enabled` lets a workspace reconnect force the
// channel-less doc out of the event fan-out.
export const reconnectSlackEventWebhook = async ({
  eventWebHookId,
  organizationId,
  url,
  slack,
  botAccessToken,
  enabled,
}: {
  eventWebHookId: string;
  organizationId: string;
  url?: string;
  slack: NonNullable<EventWebHookInterface["slack"]>;
  botAccessToken?: string;
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
  experimentIds,
  featureIds,
  metricIds,
}: {
  organizationId: string;
  eventName: NotificationEventName;
  enabled: boolean;
  tags: string[];
  projects: string[];
  // Experiments associated with this event's subject: an experiment event's own
  // id, plus (for a feature event) the experiments that feature is linked to.
  // The experiments filter is cross-subject and matches whichever the channel picks.
  experimentIds?: string[];
  // Features associated with this event's subject: a feature event's own id,
  // plus (for an experiment event) the features that experiment is linked to.
  // The feature filter is cross-subject and matches whichever the channel picks.
  featureIds?: string[];
  // Metrics associated with this event's subject (an experiment's goal/guardrail
  // metrics, or a feature's safe-rollout/experiment metrics). The metric filter
  // is cross-subject: it matches whichever of these the channel filters on.
  metricIds?: string[];
}): Promise<EventWebHookInterface[]> => {
  const allDocs = await EventWebHookModel.find({
    organizationId,
    events: { $in: [eventName, ...getWildcardPatternsForEvent(eventName)] },
    enabled,
  });

  const docs = allDocs.filter((doc) => {
    // Universal filters — apply to every event.
    if (!filterOptional(doc.tags, tags)) return false;
    if (!filterOptional(doc.projects, projects)) return false;

    // Experiments filter: cross-subject — matches an experiment event by its
    // own id AND a feature event by the experiments it's linked to
    // (`experimentIds` carries the right set per subject).
    if (!filterOptional(doc.experiments, experimentIds || [])) return false;

    // Features filter: cross-subject — matches a feature event by its own id
    // AND an experiment event by the features it's linked to (`featureIds`
    // carries the right set per subject). An experiment linked to none of the
    // filtered features is dropped when a features filter is set.
    if (!filterOptional(doc.features, featureIds || [])) return false;

    // Cross-subject metric filter: applies to both experiment and feature
    // events via the subject's associated metrics. A subject with no matching
    // metric is dropped when a metric filter is set.
    if (!filterOptional(doc.metrics, metricIds || [])) return false;

    return true;
  });

  return docs.map(toInterface);
};

// Cheap existence check: is any enabled webhook filtering by the given field?
// Used to skip resolving a subject's cross-subject associations (a context build
// + queries) on every event unless some channel actually filters by that
// dimension — e.g. a feature's safe-rollout metrics, or the features a given
// experiment is linked to.
export const orgHasWebhookFilteringBy = async (
  organizationId: string,
  field: "metrics" | "features" | "experiments",
): Promise<boolean> => {
  const doc = await EventWebHookModel.exists({
    organizationId,
    enabled: true,
    [`${field}.0`]: { $exists: true },
  });
  return !!doc;
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
