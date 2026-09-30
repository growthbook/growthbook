import { z } from "zod";
import { namedSchema } from "./openapi-helpers";
import {
  eventWebHookInterface,
  eventWebHookMethods,
  eventWebHookPayloadTypes,
  eventWebHookRequestBodySchema,
} from "./event-webhook";

export const apiEventWebhookValidator = namedSchema(
  "EventWebhook",
  z
    .object({
      id: z.string(),
      name: z.string(),
      url: z.string(),
      enabled: z.boolean(),
      events: z
        .array(z.string())
        .describe('Event names or wildcards such as "feature.*"'),
      projects: z.array(z.string()),
      tags: z.array(z.string()),
      environments: z.array(z.string()),
      payloadType: z.enum(eventWebHookPayloadTypes),
      method: z.enum(eventWebHookMethods),
      headers: z.record(z.string(), z.string()),
      signingKey: z
        .string()
        .describe("Used to verify the signature header on each request"),
      lastRunAt: z.string().meta({ format: "date-time" }).nullable(),
      lastState: eventWebHookInterface.shape.lastState,
      lastResponseBody: z.string().nullable(),
      dateCreated: z.string().meta({ format: "date-time" }),
      dateUpdated: z.string().meta({ format: "date-time" }),
    })
    .strict(),
);

export const apiEventWebhookLogValidator = namedSchema(
  "EventWebhookLog",
  z
    .object({
      id: z.string(),
      event: z.string().optional(),
      url: z.string().optional(),
      method: z.enum(eventWebHookMethods).optional(),
      result: z.enum(["success", "error"]),
      responseCode: z.number().nullable(),
      responseBody: z.string().nullable(),
      payload: z.record(z.string(), z.unknown()),
      dateCreated: z.string().meta({ format: "date-time" }),
    })
    .strict(),
);

const createBody = eventWebHookRequestBodySchema.extend({
  projects: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  environments: z.array(z.string()).optional(),
  method: z.enum(eventWebHookMethods).optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

const idParams = z.object({ id: z.string() }).strict();
const webhookResponse = z
  .object({ eventWebhook: apiEventWebhookValidator })
  .strict();

export const listEventWebhooksValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({ eventWebhooks: z.array(apiEventWebhookValidator) })
    .strict(),
  summary: "Get all event webhooks",
  operationId: "listEventWebhooks",
  tags: ["event-webhooks"],
  method: "get" as const,
  path: "/event-webhooks",
};

export const getEventWebhookValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: webhookResponse,
  summary: "Get a single event webhook",
  operationId: "getEventWebhook",
  tags: ["event-webhooks"],
  method: "get" as const,
  path: "/event-webhooks/:id",
};

export const postEventWebhookValidator = {
  bodySchema: createBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: webhookResponse,
  summary: "Create an event webhook",
  description:
    "The URL and header values can reference webhook secrets as `{{ KEY }}`, which are filled in at send time.",
  operationId: "postEventWebhook",
  tags: ["event-webhooks"],
  method: "post" as const,
  path: "/event-webhooks",
  exampleRequest: {
    body: {
      name: "Feature changes to Datadog",
      url: "https://example.com/growthbook-events",
      enabled: true,
      events: ["feature.*"],
      payloadType: "json" as const,
    },
  },
};

export const putEventWebhookValidator = {
  bodySchema: createBody.partial().strict(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: webhookResponse,
  summary: "Update an event webhook",
  operationId: "putEventWebhook",
  tags: ["event-webhooks"],
  method: "put" as const,
  path: "/event-webhooks/:id",
};

export const deleteEventWebhookValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z.object({ deletedId: z.string() }).strict(),
  summary: "Delete an event webhook",
  operationId: "deleteEventWebhook",
  tags: ["event-webhooks"],
  method: "delete" as const,
  path: "/event-webhooks/:id",
};

export const listEventWebhookLogsValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({ logs: z.array(apiEventWebhookLogValidator) })
    .strict(),
  summary: "Get the 50 most recent deliveries for an event webhook",
  operationId: "listEventWebhookLogs",
  tags: ["event-webhooks"],
  method: "get" as const,
  path: "/event-webhooks/:id/logs",
};

export const postEventWebhookTestValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z.object({ queued: z.literal(true) }).strict(),
  summary: "Send a test event to an event webhook",
  description:
    "Delivery is asynchronous; check the webhook's logs for the result.",
  operationId: "postEventWebhookTest",
  tags: ["event-webhooks"],
  method: "post" as const,
  path: "/event-webhooks/:id/test",
};
