import { z, ZodType } from "zod";
import { UnionToTuple } from "../util/types";
import {
  apiExperimentValidator,
  apiFeatureValidator,
} from "../validators/openapi";
import { userLoginInterface } from "../validators/users";
import { experimentWarningNotificationPayload } from "../validators/experiment-warnings";
import { EventUser } from "./event-types";

type Webhook = {
  readonly [key: string]: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly schema: ZodType<any>;
    readonly description: string;
    readonly isDiff: boolean;
  };
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
      isDiff: false,
    },
    updated: {
      schema: apiFeatureValidator,
      description: "Triggered when a feature is updated",
      isDiff: true,
    },
    deleted: {
      schema: apiFeatureValidator,
      description: "Triggered when a feature is deleted",
      isDiff: false,
    },
  },
  experiment: {
    created: {
      schema: apiExperimentValidator,
      description: "Triggered when an experiment is created",
      isDiff: false,
    },
    updated: {
      schema: apiExperimentValidator,
      description: "Triggered when an experiment is updated",
      isDiff: true,
    },
    deleted: {
      schema: apiExperimentValidator,
      description: "Triggered when an experiment is deleted",
      isDiff: false,
    },
    warning: {
      schema: experimentWarningNotificationPayload,
      description:
        "Triggered when a warning condition is detected on an experiment",
      isDiff: false,
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
    },
  },
} as const;

export type NotificationEvents = IsWebhooks<typeof notificationEvents>;

export type NotificationEventResource = keyof NotificationEvents;

/**
 * Supported resources for event notifications
 */
export const notificationEventResources = Object.keys(
  notificationEvents
) as NotificationEventResource[];

// Only use this for zod validations!
export const zodNotificationEventResources = notificationEventResources as UnionToTuple<NotificationEventResource>;

export type ResourceEvents<
  R extends NotificationEventResource
> = keyof NotificationEvents[R] & string;

export type NotificationEventNames<R> = R extends NotificationEventResource
  ? `${R}.${ResourceEvents<R>}`
  : never;

export type NotificationEventName = NotificationEventNames<NotificationEventResource>;

export const notificationEventNames = (Object.keys(notificationEvents) as [
  NotificationEventResource
]).reduce<NotificationEventName[]>(
  (names, key) => [
    ...names,
    ...Object.keys(notificationEvents[key]).map(
      (name) => `${key}.${name}` as NotificationEventName
    ),
  ],
  [] as NotificationEventName[]
);

// Only use this for zod validations!
export const zodNotificationEventNamesEnum = notificationEventNames as UnionToTuple<NotificationEventName>;

/**
 * Legacy Event Notification payload
 */
type OptionalNotificationEventNames<R> = R extends NotificationEventResource
  ? NotificationEventNames<R>
  : NotificationEventName;

export type LegacyNotificationEventPayload<
  ResourceType extends NotificationEventResource | undefined,
  EventName extends OptionalNotificationEventNames<ResourceType> = OptionalNotificationEventNames<ResourceType>,
  DataType = never
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
  Event extends ResourceEvents<Resource>
> = NotificationEvents[Resource][Event] extends {
  schema: ZodType<infer T, infer U, infer V>;
}
  ? z.infer<ZodType<T, U, V>>
  : never;

export type NotificationEventPayloadDataType<
  Resource extends NotificationEventResource,
  Event extends ResourceEvents<Resource>
> = NotificationEvents[Resource][Event] extends {
  isDiff: true;
}
  ? {
      object: NotificationEventPayloadSchemaType<Resource, Event>;
      previous_attributes: Partial<
        NotificationEventPayloadSchemaType<Resource, Event>
      >;
    }
  : { object: NotificationEventPayloadSchemaType<Resource, Event> };

/**
 * Event Notification payload
 */
export type NotificationEventPayload<
  Resource extends NotificationEventResource,
  Event extends ResourceEvents<Resource>
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

type NotificationEventForResourceAndEvent<
  Resource,
  Event
> = Resource extends NotificationEventResource
  ? Event extends ResourceEvents<Resource>
    ? NotificationEventPayload<Resource, Event>
    : never
  : never;

type NotificationEventForResource<
  Resource
> = Resource extends NotificationEventResource
  ? NotificationEventForResourceAndEvent<Resource, ResourceEvents<Resource>>
  : never;

export type NotificationEvent = NotificationEventForResource<NotificationEventResource>;
