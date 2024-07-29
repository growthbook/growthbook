import { randomUUID } from "crypto";
import z from "zod";
import md5 from "md5";
import intersection from "lodash/intersection";
import {
  NotificationEventName,
  zodNotificationEventNamesEnum,
} from "../events/base-types";
import {
  eventWebHookPayloadTypes,
  EventWebHookPayloadType,
  eventWebHookMethods,
  EventWebHookMethod,
} from "../types/EventWebHook";
import { legacyBaseSchema, MakeModelClass } from "./BaseModel";

const eventWebHookValidator = legacyBaseSchema
  .extend({
    url: z.string().url(),
    name: z.string().trim().min(2),
    events: z.array(z.enum(zodNotificationEventNamesEnum)).min(1),
    enabled: z.boolean(),
    projects: z.array(z.string()),
    tags: z.array(z.string()),
    environments: z.array(z.string()),
    payloadType: z.enum(eventWebHookPayloadTypes),
    method: z.enum(eventWebHookMethods),
    headers: z.object({}).catchall(z.string()),
    signingKey: z.string().min(2),
    lastRunAt: z.date().optional(),
    lastState: z.enum(["none", "success", "error"]),
    lastResponseBody: z.string().optional(),
  })
  .strict();

export type EventWebHookInterface = z.infer<typeof eventWebHookValidator>;

const BaseClass = MakeModelClass({
  schema: eventWebHookValidator,
  collectionName: "eventwebhooks",
  auditLog: {
    entity: "eventWebHook",
    createEvent: "eventWebHook.create",
    updateEvent: "eventWebHook.update",
    deleteEvent: "eventWebHook.delete",
  },
  globallyUniqueIds: true,
});

type CreateEventWebHookOptions = {
  name: string;
  url: string;
  enabled: boolean;
  events: NotificationEventName[];
  projects: string[];
  tags: string[];
  environments: string[];
  payloadType: EventWebHookPayloadType;
  method: EventWebHookMethod;
  headers: Record<string, string>;
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

type EventWebHookStatusUpdate =
  | {
      state: "success";
      responseBody: string | null;
    }
  | {
      state: "error";
      error: string;
    };

const filterOptional = <T>(want: T[] = [], has: T[]) => {
  if (!want.length) return true;
  return !!intersection(want, has).length;
};

export class EventWebHookModel extends BaseClass {
  protected canRead() {
    return this.context.permissions.canViewEventWebhook();
  }

  protected canCreate() {
    return this.context.permissions.canCreateEventWebhook();
  }

  protected canUpdate() {
    return this.context.permissions.canUpdateEventWebhook();
  }

  protected canDelete() {
    return this.context.permissions.canDeleteEventWebhook();
  }

  public create(payload: CreateEventWebHookOptions) {
    const signingKey = "ewhk_" + md5(randomUUID()).substr(0, 32);

    return super.create({ ...payload, signingKey, lastState: "none" });
  }

  public update(
    existing: EventWebHookInterface,
    payload: UpdateEventWebHookAttributes
  ) {
    return super.update(existing, payload);
  }

  public updateById(id: string, payload: UpdateEventWebHookAttributes) {
    return super.updateById(id, payload);
  }

  public updateEventWebHookStatus(
    id: string,
    status: EventWebHookStatusUpdate
  ) {
    const lastResponseBody =
      status.state === "success" ? status.responseBody : status.error;

    return super.updateById(id, {
      lastState: status.state,
      lastResponseBody:
        lastResponseBody === null ? undefined : lastResponseBody,
    });
  }

  public getAllForEvent = async ({
    eventName,
    enabled,
    tags,
    projects,
  }: {
    eventName: NotificationEventName;
    enabled: boolean;
    tags: string[];
    projects: string[];
  }): Promise<EventWebHookInterface[]> => {
    const allDocs = await super._find({
      events: eventName,
      enabled,
    });

    return allDocs.filter((doc) => {
      if (!filterOptional(doc.tags, tags)) return false;
      if (!filterOptional(doc.projects, projects)) return false;

      return true;
    });
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected migrate(doc: any): EventWebHookInterface {
    const { method, payloadType, headers, ...data } = doc;

    return {
      ...data,
      method: method || "GET",
      payloadType: payloadType || "raw",
      headers: headers || {},
    };
  }
}
