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

// The org member an org key acted for (`X-On-Behalf-Of` request header).
// Attribution only: it never changes what the key may do.
export const eventUserOnBehalfOf = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  })
  .strict();

export type EventUserOnBehalfOf = z.infer<typeof eventUserOnBehalfOf>;

// Actor shape the REST API returns: the event user without the API key id.
export const apiEventUser = z
  .object({
    type: z.enum(["dashboard", "api_key", "system"]),
    id: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
    onBehalfOf: eventUserOnBehalfOf
      .optional()
      .describe("The organization member an API key acted for"),
  })
  .strict();

const eventUserApiKey = z
  .object({
    type: z.literal("api_key"),
    apiKey: z.string(),
    id: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
    onBehalfOf: eventUserOnBehalfOf.optional(),
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
