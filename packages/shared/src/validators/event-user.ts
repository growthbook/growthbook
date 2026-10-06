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

// The member who asked an organization API key to make a request
// (`X-Requested-By`). The key's own permissions apply unless it limits each
// request to this member's.
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
export const apiEventUser = z
  .object({
    type: z.enum(["dashboard", "api_key", "system"]),
    id: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
    requestedBy: eventUserRequestedBy
      .optional()
      .describe("The organization member who asked the API key to act"),
    limitedToRequester: z
      .boolean()
      .optional()
      .describe(
        "True when the request was limited to the requester's permissions",
      ),
  })
  .strict();

const eventUserApiKey = z
  .object({
    type: z.literal("api_key"),
    apiKey: z.string(),
    id: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
    requestedBy: eventUserRequestedBy.optional(),
    limitedToRequester: z.boolean().optional(),
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
