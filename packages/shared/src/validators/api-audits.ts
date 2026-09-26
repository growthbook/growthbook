import { z } from "zod";
import { entityTypes } from "../constants";
import { namedSchema } from "./openapi-helpers";

const cursorQuery = {
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Defaults to 50"),
  before: z.iso
    .datetime()
    .optional()
    .describe(
      "Only return entries older than this. Pass the previous page's `nextCursor` to page back.",
    ),
};

const nextCursor = z
  .string()
  .meta({ format: "date-time" })
  .nullable()
  .describe("Null when there are no older entries");

export const apiAuditValidator = namedSchema(
  "Audit",
  z
    .object({
      id: z.string(),
      event: z.string().describe('e.g. "feature.update"'),
      entity: z.object({
        object: z.string(),
        id: z.string(),
        name: z.string().optional(),
      }),
      parent: z.object({ object: z.string(), id: z.string() }).optional(),
      user: z
        .object({
          id: z.string().optional(),
          email: z.string().optional(),
          name: z.string().optional(),
          apiKey: z
            .string()
            .optional()
            .describe("Id of the API key that made the change"),
          system: z.boolean().optional(),
        })
        .describe("Who made the change: a member, an API key, or the system"),
      reason: z.string().optional(),
      details: z
        .string()
        .optional()
        .describe("JSON-encoded, usually `pre`, `post` and `context`"),
      dateCreated: z.string().meta({ format: "date-time" }),
    })
    .strict(),
);

export const apiEventValidator = namedSchema(
  "Event",
  z
    .object({
      id: z.string(),
      event: z.string().describe('e.g. "feature.updated"'),
      version: z.number().optional().describe("Absent on legacy events"),
      data: z
        .record(z.string(), z.unknown())
        .describe("The same payload event webhooks receive"),
      dateCreated: z.string().meta({ format: "date-time" }),
    })
    .strict(),
);

export const listAuditsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      entityType: z.enum(entityTypes),
      entityId: z
        .string()
        .optional()
        .describe("Omit for every entity of this type"),
      ...cursorQuery,
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({ audits: z.array(apiAuditValidator), nextCursor })
    .strict(),
  summary: "Get audit history for an entity or entity type",
  description:
    "Includes changes to child entities (e.g. a feature's revisions). Newest first. Requires permission to view audit logs.",
  operationId: "listAudits",
  tags: ["audits"],
  method: "get" as const,
  path: "/audits",
};

export const listEventsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      events: z
        .string()
        .optional()
        .describe('Comma-separated event names, e.g. "feature.updated"'),
      after: z.iso.datetime().optional(),
      ...cursorQuery,
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({ events: z.array(apiEventValidator), nextCursor })
    .strict(),
  summary: "Get the organization's event log",
  description:
    "The events that drive event webhooks and notifications. Newest first. Requires permission to view audit logs.",
  operationId: "listEvents",
  tags: ["audits"],
  method: "get" as const,
  path: "/events",
};

export const getEventValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ id: z.string() }).strict(),
  responseSchema: z.object({ event: apiEventValidator }).strict(),
  summary: "Get a single event",
  operationId: "getEvent",
  tags: ["audits"],
  method: "get" as const,
  path: "/events/:id",
};
