import { z } from "zod";
import {
  zodNotificationEventNamesEnum,
  zodNotificationEventResources,
} from "back-end/src/events/base-types";

const eventUserLoggedIn = z
  .object({
    type: z.literal("dashboard"),
    id: z.string(),
    email: z.string(),
    name: z.string(),
  })
  .strict();

export type EventUserLoggedIn = z.infer<typeof eventUserLoggedIn>;

const eventUserApiKey = z
  .object({
    type: z.literal("api_key"),
    apiKey: z.string(),
  })
  .strict();

const eventUserSystem = z.object({ type: z.literal("system") }).strict();

export type EventUserApiKey = z.infer<typeof eventUserApiKey>;

export const eventUser = z.union([
  eventUserLoggedIn,
  eventUserApiKey,
  eventUserSystem,
  z.null(),
]);

export type EventUser = z.infer<typeof eventUser>;

export const eventData = <T extends z.ZodTypeAny>(data: T) =>
  z
    .object({
      event: z.enum(zodNotificationEventNamesEnum),
      object: z.enum(zodNotificationEventResources),
      data,
      api_version: z.string().regex(/[\d]+-[\d]+-[\d]+/),
      created: z.number(),
      projects: z.array(z.string()),
      environments: z.array(z.string()),
      tags: z.array(z.string()),
      containsSecrets: z.boolean(),
      user: z.union([eventUserLoggedIn, eventUser]),
    })
    .strict();
