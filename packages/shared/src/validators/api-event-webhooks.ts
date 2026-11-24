import { z } from "zod";
import { datadogEventsUrl, datadogSites } from "../util/datadog";
import { namedSchema } from "./openapi-helpers";
import { apiWebhookTimeoutSeconds } from "./webhooks";
import {
  datadogEventWebHookSettings,
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
        .describe(
          'Event names or wildcards such as "feature.*", or "*" for every event. A `datadog` webhook sends only the events it supports.',
        ),
      projects: z.array(z.string()),
      tags: z.array(z.string()),
      environments: z.array(z.string()),
      payloadType: z.enum(eventWebHookPayloadTypes),
      method: z.enum(eventWebHookMethods),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe("Only returned by GET"),
      timeoutSeconds: apiWebhookTimeoutSeconds,
      datadog: datadogEventWebHookSettings
        .optional()
        .describe("Settings for the `datadog` payload type."),
      signingKey: z
        .string()
        .optional()
        .describe(
          "Used to verify the signature header on each request. Only returned by GET.",
        ),
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

const datadogUrls = datadogSites
  .map((site) => `\`${datadogEventsUrl(site.id)}\``)
  .join(", ");

const createBody = eventWebHookRequestBodySchema.extend({
  url: eventWebHookRequestBodySchema.shape.url.describe(
    `Where events are sent. For a \`datadog\` webhook, Datadog's event intake for your site: ${datadogUrls}.`,
  ),
  events: eventWebHookRequestBodySchema.shape.events
    .optional()
    .describe(
      'Event names or wildcards such as "feature.*", or "*" for every event. Required, except a `datadog` webhook defaults to "*" and sends only the events it supports.',
    ),
  projects: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  environments: z.array(z.string()).optional(),
  method: z.enum(eventWebHookMethods).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  timeoutSeconds: apiWebhookTimeoutSeconds.optional(),
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
    "The URL and header values can reference webhook secrets as `{{ KEY }}`, which are filled in at send time. A `datadog` webhook must use `POST` and send its API key in a `DD-API-KEY` header; see [Send changes to Datadog](https://docs.growthbook.io/integrations/datadog#send-changes-to-datadog).",
  confirmation: ["settings.webhooks"] as const,
  operationId: "postEventWebhook",
  tags: ["event-webhooks"],
  method: "post" as const,
  path: "/event-webhooks",
  exampleRequest: {
    body: {
      name: "Datadog change tracking",
      url: "https://event-management-intake.datadoghq.com/api/v2/events",
      enabled: true,
      payloadType: "datadog" as const,
      headers: { "DD-API-KEY": "{{ DATADOG_API_KEY }}" },
      environments: ["production"],
      datadog: { serviceField: "datadog-service" },
    },
  },
};

export const putEventWebhookValidator = {
  bodySchema: createBody.partial().strict(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: webhookResponse,
  summary: "Update an event webhook",
  confirmation: ["settings.webhooks"] as const,
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
  confirmation: ["settings.webhooks"] as const,
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
  confirmation: ["settings.webhooks"] as const,
  operationId: "postEventWebhookTest",
  tags: ["event-webhooks"],
  method: "post" as const,
  path: "/event-webhooks/:id/test",
};
