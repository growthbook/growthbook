import { z } from "zod";

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

export type EventUserApiKey = z.infer<typeof eventUserApiKey>;

export const eventUser = z.union([
  eventUserLoggedIn,
  eventUserApiKey,
  z.null(),
]);

export type EventUser = z.infer<typeof eventUser>;
