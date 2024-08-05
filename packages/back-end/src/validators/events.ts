import { z } from "zod";

const eventUserLoggedIn = z
  .object({
    type: z.literal("dashboard"),
    id: z.string(),
    email: z.string(),
    name: z.string(),
  })
  .strict();

const eventUserApiKey = z
  .object({
    type: z.literal("api_key"),
    apiKey: z.string(),
  })
  .strict();

export const eventUser = z.union([
  eventUserLoggedIn,
  eventUserApiKey,
  z.null(),
]);

export type EventUser = z.infer<typeof eventUser>;
