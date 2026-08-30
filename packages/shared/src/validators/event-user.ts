import { z } from "zod";

export const eventUserLoggedIn = z
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
    id: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
  })
  .strict();

export type EventUserApiKey = z.infer<typeof eventUserApiKey>;

const eventUserSystem = z.object({
  type: z.literal("system"),
  subtype: z.string().optional(),
  id: z.string().optional(),
});

export const eventUser = z.union([
  eventUserLoggedIn,
  eventUserApiKey,
  eventUserSystem,
  z.null(),
]);

export type EventUser = z.infer<typeof eventUser>;
