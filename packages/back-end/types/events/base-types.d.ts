import { z, ZodType } from "zod";
import { notificationEvents } from "back-end/src/validators/events";
import { DiffResult } from "./diff";
import { EventUser } from "./event-types";

export type WebhookEntry = {
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

export type NotificationEvents = IsWebhooks<typeof notificationEvents>;

export type NotificationEventResource = keyof NotificationEvents;

export type ResourceEvents<R extends NotificationEventResource> =
  keyof NotificationEvents[R] & string;

export type NotificationEventNames<R> = R extends NotificationEventResource
  ? `${R}.${ResourceEvents<R>}`
  : never;

export type NotificationEventName =
  NotificationEventNames<NotificationEventResource>;

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
