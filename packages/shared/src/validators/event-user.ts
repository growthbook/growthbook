import { z } from "zod";
import { namedSchema } from "./openapi-helpers";

export const eventUserLoggedIn = z
  .object({
    type: z.literal("dashboard"),
    id: z.string(),
    email: z.string(),
    name: z.string(),
  })
  .strict();

export type EventUserLoggedIn = z.infer<typeof eventUserLoggedIn>;

// The member who asked an organization API key to make a request
// (`X-Requested-By`).
export const eventUserRequestedBy = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  })
  .strict();

export type EventUserRequestedBy = z.infer<typeof eventUserRequestedBy>;

// Actor shape the REST API returns: the event user without the API key id.
// For an organization API key, `name` is the key's name.
export const apiEventUser = namedSchema(
  "EventUser",
  z
    .object({
      type: z.enum(["dashboard", "api_key", "system"]),
      id: z.string().optional(),
      name: z.string().optional(),
      email: z.string().optional(),
      requestedBy: eventUserRequestedBy
        .optional()
        .describe("The organization member who asked the API key to act"),
      extendedByRequester: z
        .boolean()
        .optional()
        .describe(
          "True when the named member's permissions extended the key's for this request",
        ),
    })
    .strict()
    .describe("The user (or automated actor) responsible for an action"),
);

export type ApiEventUser = z.infer<typeof apiEventUser>;

const eventUserApiKey = z
  .object({
    type: z.literal("api_key"),
    apiKey: z.string(),
    id: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
    requestedBy: eventUserRequestedBy.optional(),
    extendedByRequester: z.boolean().optional(),
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
