import { z } from "zod";
import { zodNotificationEventNamesEnum } from "./events";

export const eventWebHookPayloadTypes = [
  "raw",
  "json",
  "slack",
  "discord",
] as const;

export type EventWebHookPayloadType = (typeof eventWebHookPayloadTypes)[number];

export const eventWebHookMethods = ["POST", "PUT", "PATCH"] as const;

export type EventWebHookMethod = (typeof eventWebHookMethods)[number];

// Wildcard pattern for event matching: "resource.*" captures all events for a resource
const eventNameOrWildcard = z.string().refine(
  (val: string) => {
    // Either a valid event name or a wildcard pattern (e.g., "feature.*")
    return (
      zodNotificationEventNamesEnum.includes(val as never) ||
      /^[a-z]+(\.[a-zA-Z]+)*\.\*$/.test(val)
    );
  },
  {
    message: `Must be a valid event name or wildcard pattern (e.g., "feature.*")`,
  },
);

export const eventWebHookInterface = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    url: z.string().url(),
    name: z.string().trim().min(2),
    events: z.array(eventNameOrWildcard).min(1),
    enabled: z.boolean(),
    projects: z.array(z.string()),
    tags: z.array(z.string()),
    environments: z.array(z.string()),
    payloadType: z.enum(eventWebHookPayloadTypes),
    method: z.enum(eventWebHookMethods),
    headers: z.record(z.string(), z.string()),
    signingKey: z.string().min(2),
    lastRunAt: z.union([z.date(), z.null()]),
    lastState: z.enum(["none", "success", "error"]),
    lastResponseBody: z.union([z.string(), z.null()]),
  })
  .strict();

export type EventWebHookInterface = z.infer<typeof eventWebHookInterface>;
