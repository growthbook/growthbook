import { z } from "zod";
import type {
  AuditUserApiKey,
  AuditUserLoggedIn,
  AuditUserSystem,
} from "shared/types/audit";
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
// (`X-GrowthBook-Requested-By`).
export const eventUserRequestedBy = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  })
  .strict();

export type EventUserRequestedBy = z.infer<typeof eventUserRequestedBy>;

// A stored person reference: who drafted, reviewed, merged or acted.
export const personIdField = z
  .string()
  .describe(
    "The person's user ID: the signed-in member, a Personal Access Token's owner, or the member an organization API key named with `X-GrowthBook-Requested-By`. Empty when an organization API key named no one",
  );

// For REST docs on a verdict: who it belongs to.
export const REVIEW_VERDICT_NOTE =
  "A verdict (`approve` or `request-changes`) belongs to the person behind the request: the signed-in member, a Personal Access Token's owner, or the member an organization API key names with `X-GrowthBook-Requested-By`. An organization API key that names no one can only comment, and no one can rule on a draft created in their own name.";

// For REST docs on anything that needs a person behind the request.
export const REQUIRES_PERSON_NOTE =
  "Requires a Personal Access Token, or an organization API key that names a member with `X-GrowthBook-Requested-By`.";

const requestedByField = eventUserRequestedBy.describe(
  "The member an organization API key named with `X-GrowthBook-Requested-By`. When present, this member is the person behind the action.",
);

const assumedRoleField = z
  .boolean()
  .describe(
    "True when the request assumed the named member's role, with only the permissions both the key and the member hold. Absent when the key kept its own role.",
  );

// Actor shape the REST API returns: the event user without the API key id.
// For an organization API key, `name` is the key's name.
export const apiEventUser = namedSchema(
  "EventUser",
  z
    .object({
      type: z
        .enum(["dashboard", "api_key", "system"])
        .describe(
          "`dashboard` for a signed-in member, `api_key` for an organization API key or a personal access token, `system` for GrowthBook itself",
        ),
      id: z
        .string()
        .describe(
          "The member's user ID: the signed-in member, or a personal access token's owner. Absent for an organization API key, which names its member in `requestedBy`",
        )
        .optional(),
      name: z
        .string()
        .describe(
          "The member's name, or the key's name for an organization API key",
        )
        .optional(),
      email: z
        .string()
        .describe(
          "The member's email. Absent for an organization API key, which names its member in `requestedBy`",
        )
        .optional(),
      requestedBy: requestedByField.optional(),
      assumedRole: assumedRoleField.optional(),
    })
    .strict()
    .describe(
      "Who performed an action. The person behind it is `requestedBy` when an organization API key named a member, otherwise `id`",
    ),
);

export type ApiEventUser = z.infer<typeof apiEventUser>;

const eventUserApiKey = z
  .object({
    type: z.literal("api_key"),
    apiKey: z.string(),
    id: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
    requestedBy: requestedByField.optional(),
    assumedRole: assumedRoleField.optional(),
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

// The person behind an event user: the signed-in member, a personal token's
// user, or the member an org key acted for. Null for keys acting as nobody.
export function eventUserPerson(
  user: EventUser,
): { id?: string; name?: string; email?: string } | null {
  if (!user) return null;
  if (user.type === "dashboard") {
    return { id: user.id, name: user.name, email: user.email };
  }
  if (user.type === "api_key") {
    if (user.requestedBy) return user.requestedBy;
    return user.id ? { id: user.id, name: user.name, email: user.email } : null;
  }
  return null;
}

export function eventUserPersonId(user: EventUser): string | null {
  return eventUserPerson(user)?.id || null;
}

// Stable identifier for a reviewer across review lifecycle events, or null if
// the event user can't hold a review verdict (system/anonymous users). The
// member an org key names is the reviewer, not the key.
export function reviewerKeyForEventUser(user: EventUser): string | null {
  if (!user) return null;
  if (user.type === "dashboard") return user.id;
  if (user.type === "api_key") {
    return eventUserPersonId(user) || user.apiKey || null;
  }
  return null;
}

// One line naming an actor: "Dana via CI key" when an org key named Dana,
// "Pat (API)" for a personal access token, "CI key (API)" for a key that named
// no one. `nameFor` supplies a member's current name.
export function eventUserLabel(
  user: EventUser,
  {
    withEmail = false,
    nameFor,
  }: {
    withEmail?: boolean;
    nameFor?: (userId: string) => string | undefined;
  } = {},
): string {
  if (!user) return "";
  if (user.type === "system") return "System";
  const person = eventUserPerson(user);
  const name = (person?.id && nameFor?.(person.id)) || person?.name;
  const personText =
    withEmail && name && person?.email
      ? `${name} (${person.email})`
      : name || person?.email || person?.id || "";
  if (user.type === "dashboard") return personText;
  const keyName = user.id ? "" : user.name || "";
  if (user.requestedBy) return `${personText} via ${keyName || "API key"}`;
  if (personText) return `${personText} (API)`;
  return keyName ? `${keyName} (API)` : "API key";
}

// Who a review webhook credits; see `eventUserCredit`.
export const eventReviewer = z
  .object({
    id: z
      .string()
      .describe(
        "The reviewer's user ID: the signed-in member, a personal access token's owner, or the member an organization API key named",
      )
      .optional(),
    name: z
      .string()
      .describe(
        "The reviewer's name, or the key's name when an organization API key named no one",
      )
      .optional(),
    email: z.string().describe("The reviewer's email").optional(),
  })
  .strict();

// Who an action is credited to: the person, or the key's name when an org
// key named no one.
export function eventUserCredit(
  user: EventUser,
): z.infer<typeof eventReviewer> {
  const person = eventUserPerson(user);
  if (person) return person;
  return user?.type === "api_key" && user.name ? { name: user.name } : {};
}

export function auditUserToEventUser(
  user: AuditUserLoggedIn | AuditUserApiKey | AuditUserSystem,
): EventUser {
  if ("system" in user && user.system) return { type: "system" };
  if ("apiKey" in user) {
    return {
      type: "api_key",
      apiKey: user.apiKey,
      id: user.id,
      name: user.name,
      email: user.email,
      requestedBy: user.requestedBy,
      assumedRole: user.assumedRole,
    };
  }
  const u = user as AuditUserLoggedIn;
  return { type: "dashboard", id: u.id, email: u.email, name: u.name };
}
