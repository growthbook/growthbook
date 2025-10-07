import { z, ZodType } from "zod";
import { UnionToTuple } from "shared/util";
import {
  apiExperimentValidator,
  apiFeatureValidator,
} from "back-end/src/validators/openapi";
import { eventUser } from "back-end/src/validators/events";
import { userLoginInterface } from "back-end/src/validators/users";
import { experimentWarningNotificationPayload } from "back-end/src/validators/experiment-warnings";
import { experimentInfoSignificance } from "back-end/src/validators/experiment-info";
import { experimentDecisionNotificationPayload } from "back-end/src/validators/experiment-decision";
import {
  safeRolloutDecisionNotificationPayload,
  safeRolloutUnhealthyNotificationPayload,
} from "back-end/src/validators/safe-rollout-notifications";
import { DiffResult } from "back-end/src/events/handlers/webhooks/event-webhooks-utils";
import { EventUser } from "./event-types";

type WebhookEntry = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly schema: ZodType<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly extra?: ZodType<any>;
  readonly description: string;
  readonly isDiff?: boolean;
  readonly firstVersion?: string;
  readonly noDoc?: boolean;
};

type Webhook = {
  readonly [key: string]: WebhookEntry;
};

type IsWebhooks<T> = T extends {
  readonly [key: string]: Webhook;
}
  ? T
  : never;

const webhookTestEventSchema = z.object({ webhookId: z.string() }).strict();

export const notificationEvents = {
  feature: {
    created: {
      schema: apiFeatureValidator,
      description: "Triggered when a feature is created",
    },
    updated: {
      schema: apiFeatureValidator,
      description: "Triggered when a feature is updated",
      isDiff: true,
    },
    deleted: {
      schema: apiFeatureValidator,
      description: "Triggered when a feature is deleted",
    },
    "saferollout.ship": {
      schema: safeRolloutDecisionNotificationPayload,
      description:
        "Triggered when a safe rollout is completed and safe to rollout to 100%.",
    },
    "saferollout.rollback": {
      schema: safeRolloutDecisionNotificationPayload,
      description:
        "Triggered when a safe rollout has a failing guardrail and should be reverted.",
    },
    "saferollout.unhealthy": {
      schema: safeRolloutUnhealthyNotificationPayload,
      description:
        "Triggered when a safe rollout is failing a health check and may not be working as expected.",
    },
  },
  experiment: {
    created: {
      schema: apiExperimentValidator,
      description: "Triggered when an experiment is created",
    },
    updated: {
      schema: apiExperimentValidator,
      description: "Triggered when an experiment is updated",
      isDiff: true,
    },
    deleted: {
      schema: apiExperimentValidator,
      description: "Triggered when an experiment is deleted",
    },
    warning: {
      schema: experimentWarningNotificationPayload,
      description:
        "Triggered when a warning condition is detected on an experiment",
    },
    "info.significance": {
      schema: experimentInfoSignificance,
      description: `Triggered when a goal or guardrail metric reaches significance in an experiment (e.g. either above 95% or below 5% chance to win). Be careful using this without Sequential Testing as it can lead to peeking problems.`,
    },
    "decision.ship": {
      schema: experimentDecisionNotificationPayload,
      description: `Triggered when an experiment is ready to ship a variation.`,
    },
    "decision.rollback": {
      schema: experimentDecisionNotificationPayload,
      description: `Triggered when an experiment should be rolled back to the control.`,
    },
    "decision.review": {
      schema: experimentDecisionNotificationPayload,
      description: `Triggered when an experiment has reached the desired power point, but the results may be ambiguous.`,
    },
  },
  user: {
    login: {
      schema: userLoginInterface,
      description: "Triggered when a user logs in",
      isDiff: false,
    },
  },
  webhook: {
    test: {
      schema: webhookTestEventSchema,
      description: "Triggered when a webhook is being tested",
      isDiff: false,
      noDoc: true,
    },
  },
} as const;

export type NotificationEvents = IsWebhooks<typeof notificationEvents>;

export type NotificationEventResource = keyof NotificationEvents;

/**
 * Supported resources for event notifications
 */
export const notificationEventResources = Object.keys(
  notificationEvents,
) as NotificationEventResource[];

// Only use this for zod validations!
export const zodNotificationEventResources =
  notificationEventResources as UnionToTuple<NotificationEventResource>;

export type ResourceEvents<R extends NotificationEventResource> =
  keyof NotificationEvents[R] & string;

export type NotificationEventNames<R> = R extends NotificationEventResource
  ? `${R}.${ResourceEvents<R>}`
  : never;

export type NotificationEventName =
  NotificationEventNames<NotificationEventResource>;

export const notificationEventNames = (
  Object.keys(notificationEvents) as [NotificationEventResource]
).reduce<NotificationEventName[]>(
  (names, key) => [
    ...names,
    ...Object.keys(notificationEvents[key]).map(
      (name) => `${key}.${name}` as NotificationEventName,
    ),
  ],
  [] as NotificationEventName[],
);

// Only use this for zod validations!
export const zodNotificationEventNamesEnum =
  notificationEventNames as UnionToTuple<NotificationEventName>;

/**
 * Legacy Event Notification payload
 */
type OptionalNotificationEventNames<R> = R extends NotificationEventResource
  ? NotificationEventNames<R>
  : NotificationEventName;

export type LegacyNotificationEventPayload<
  ResourceType extends NotificationEventResource | undefined,
  EventName extends
    OptionalNotificationEventNames<ResourceType> = OptionalNotificationEventNames<ResourceType>,
  DataType = never,
> = {
  event: EventName;
  object: ResourceType;
  data: DataType;
  user: EventUser;
  projects: string[];
  tags: string[];
  environments: string[];
  containsSecrets: boolean;
};

export type NotificationEventPayloadSchemaType<
  Resource extends NotificationEventResource,
  Event extends ResourceEvents<Resource>,
> = NotificationEvents[Resource][Event] extends {
  schema: ZodType<infer T, infer U, infer V>;
}
  ? z.infer<ZodType<T, U, V>>
  : never;

export type NotificationEventPayloadExtraAttributes<
  Resource extends NotificationEventResource,
  Event extends ResourceEvents<Resource>,
> = NotificationEvents[Resource][Event] extends {
  extra: ZodType<infer T, infer U, infer V>;
}
  ? z.infer<ZodType<T, U, V>>
  : unknown;

export const notificationEventPayloadData = <
  Resource extends NotificationEventResource,
  Event extends ResourceEvents<Resource>,
>(
  resource: Resource,
  event: Event,
) => {
  const data = notificationEvents[resource][event] as WebhookEntry;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schema = data.schema as z.ZodObject<any>;

  const ret = z.object({
    object: schema,
    ...(data.isDiff
      ? {
          previous_attributes: schema.partial(),
          changes: z
            .object({
              added: z.record(z.string(), z.unknown()),
              removed: z.record(z.string(), z.unknown()),
              modified: z.record(z.string(), z.unknown()),
            })
            .optional(),
        }
      : {}),
  });

  if (!data.extra) return ret;

  return z.union([ret, data.extra]);
};

export type NotificationEventPayloadDataType<
  Resource extends NotificationEventResource,
  Event extends ResourceEvents<Resource>,
  Obj = NotificationEventPayloadSchemaType<Resource, Event>,
  PreviousAttributes = Partial<Obj>,
> = NotificationEvents[Resource][Event] extends {
  isDiff: true;
}
  ? {
      object: Obj;
      previous_attributes: PreviousAttributes;
      changes?: DiffResult;
    } & NotificationEventPayloadExtraAttributes<Resource, Event>
  : { object: Obj } & NotificationEventPayloadExtraAttributes<Resource, Event>;

/**
 * Event Notification payload
 */
export type NotificationEventPayload<
  Resource extends NotificationEventResource,
  Event extends ResourceEvents<Resource>,
> = {
  event: `${Resource}.${Event}`;
  object: Resource;
  api_version: `${number}-${number}-${number}`;
  created: number;
  data: NotificationEventPayloadDataType<Resource, Event>;
  user: EventUser;
  projects: string[];
  tags: string[];
  environments: string[];
  containsSecrets: boolean;
};

export const notificationEventPayload = <
  Resource extends NotificationEventResource,
  Event extends ResourceEvents<Resource>,
>(
  resource: Resource,
  event: Event,
) =>
  z.object({
    event: z.literal(`${resource}.${event}`),
    object: z.literal(resource),
    api_version: z.string(),
    created: z.number(),
    data: notificationEventPayloadData(resource, event),
    user: eventUser,
    tags: z.array(z.string()),
    environments: z.array(z.string()),
    containsSecrets: z.boolean(),
  });

type NotificationEventForResourceAndEvent<Resource, Event> =
  Resource extends NotificationEventResource
    ? Event extends ResourceEvents<Resource>
      ? NotificationEventPayload<Resource, Event>
      : never
    : never;

type NotificationEventForResource<Resource> =
  Resource extends NotificationEventResource
    ? NotificationEventForResourceAndEvent<Resource, ResourceEvents<Resource>>
    : never;

export type NotificationEvent =
  NotificationEventForResource<NotificationEventResource>;
