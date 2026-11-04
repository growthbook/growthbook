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

export const eventUserRequestedBy = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  })
  .strict();

export type EventUserRequestedBy = z.infer<typeof eventUserRequestedBy>;

export const actorIdField = z
  .string()
  .describe(
    "Who acted: a member's user ID, or an API key's ID when it acted as itself",
  );

export const REVIEW_VERDICT_NOTE =
  "The verdict belongs to whoever the request acts as; see [Naming who asked](/api/introduction#naming-who-asked). No one can rule on a draft they created.";

export const REQUIRES_PERSON_NOTE =
  "Needs a personal access token, or an organization API key that assumes a named member's role.";

const requestedByField = eventUserRequestedBy.describe(
  "The member named with `X-GrowthBook-Requested-By`",
);

const assumedRoleField = z
  .boolean()
  .describe("Whether the key assumed the named member's role");

// Actor shape the REST API returns.
export const apiEventUser = namedSchema(
  "EventUser",
  z
    .object({
      type: z
        .enum(["dashboard", "api_key", "system"])
        .describe(
          "`dashboard` (signed-in member), `api_key` (API key or personal access token) or `system`",
        ),
      id: z
        .string()
        .describe("The member's user ID. Absent for an organization API key")
        .optional(),
      apiKey: z
        .string()
        .describe("The API key's ID, when the action came through one")
        .optional(),
      name: z
        .string()
        .describe("The member's name, or the organization API key's name")
        .optional(),
      email: z
        .string()
        .describe("The member's email. Absent for an organization API key")
        .optional(),
      requestedBy: requestedByField.optional(),
      assumedRole: assumedRoleField.optional(),
    })
    .strict()
    .describe("Who performed an action"),
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
// user, or the member whose role an org key assumed. Null for a key acting as
// itself, even when it names who asked.
export function eventUserPerson(
  user: EventUser,
): { id?: string; name?: string; email?: string } | null {
  if (!user) return null;
  if (user.type === "dashboard") {
    return { id: user.id, name: user.name, email: user.email };
  }
  if (user.type === "api_key") {
    if (user.requestedBy) return user.assumedRole ? user.requestedBy : null;
    return user.id ? { id: user.id, name: user.name, email: user.email } : null;
  }
  return null;
}

export function eventUserPersonId(user: EventUser): string | null {
  return eventUserPerson(user)?.id || null;
}

// Who an event user acts as: its person, else the key itself. Authorship and
// verdicts compare these, so a key acting as itself is its own identity.
export function eventUserIdentity(user: EventUser): string | null {
  if (!user) return null;
  if (user.type === "dashboard") return user.id;
  if (user.type === "api_key") {
    return eventUserPersonId(user) || user.apiKey || null;
  }
  return null;
}

// The name of the org key an event user came through; empty for a personal
// access token, which acts as its user.
export function eventUserKeyName(user: EventUser | undefined): string {
  return user?.type === "api_key" && !user.id ? (user.name || "").trim() : "";
}

// The org key an event user came through while assuming a member's role.
export function assumingKeyOf(user: EventUser | undefined): string | null {
  return user?.type === "api_key" && user.assumedRole && user.requestedBy
    ? user.apiKey
    : null;
}

type ActorSources = {
  createdBy?: EventUser;
  publishedBy?: EventUser;
  reviews?: { user?: EventUser }[];
  activityLog?: { user?: EventUser }[];
};

// A revision's stored actors: its creator, its activity in order, its
// reviews, then its publisher.
export function revisionActors(
  revision: ActorSources,
): NonNullable<EventUser>[] {
  return [
    revision.createdBy,
    ...(revision.activityLog ?? []).map((e) => e.user),
    ...(revision.reviews ?? []).map((r) => r.user),
    revision.publishedBy,
  ].filter((actor): actor is NonNullable<EventUser> => !!actor);
}

// The stored actor behind an identity on a revision, falling back to a member
// reference for entries that predate stored actors. To show one action, use
// that action's own actor.
export function revisionActor(revision: ActorSources, id: string): EventUser {
  return (
    revisionActors(revision).find(
      (actor) => eventUserIdentity(actor) === id,
    ) ?? {
      type: "dashboard",
      id,
      name: "",
      email: "",
    }
  );
}

// One line naming an actor, led by whoever acted: "Dana via Slackbot" when an
// org key named Slackbot assumed Dana's role, "Slackbot for Dana" when it acted
// as itself and named her, "Pat (API)" for a personal access token, "Slackbot
// (API)" for a key that named no one. `nameFor` supplies a member's current name.
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
  // A key acting as itself still names who asked.
  const person =
    (user.type === "api_key" && user.requestedBy) || eventUserPerson(user);
  const name = (person?.id && nameFor?.(person.id)) || person?.name;
  const personText =
    withEmail && name && person?.email
      ? `${name} (${person.email})`
      : name || person?.email || person?.id || "";
  if (user.type === "dashboard") return personText;
  const keyName = eventUserKeyName(user);
  if (user.requestedBy) {
    return user.assumedRole
      ? `${personText} via ${keyName || "API key"}`
      : `${keyName || "API key"} for ${personText}`;
  }
  if (personText) return `${personText} (API)`;
  return keyName ? `${keyName} (API)` : "API key";
}

// Who an action is credited to: the person, or the key's name when an org
// key named no one.
export function eventUserCredit(user: EventUser): {
  id?: string;
  name?: string;
  email?: string;
} {
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

// How the v1 REST API and older webhook fields name an actor: a member's name,
// "API" or "SYSTEM".
export function eventUserLegacyLabel(
  user: EventUser | undefined,
): string | undefined {
  if (!user) return undefined;
  if (user.type === "api_key") return "API";
  if (user.type === "system") return "SYSTEM";
  return user.name || undefined;
}

// The REST shape of a stored actor.
export function eventUserToApiEventUser(
  user: EventUser | undefined,
): ApiEventUser | undefined {
  if (!user) return undefined;
  switch (user.type) {
    case "dashboard":
      return {
        type: "dashboard",
        id: user.id,
        name: user.name,
        email: user.email,
      };
    case "api_key":
      return {
        type: "api_key",
        apiKey: user.apiKey,
        id: user.id,
        name: user.name,
        email: user.email,
        ...(user.requestedBy ? { requestedBy: user.requestedBy } : {}),
        ...(user.assumedRole ? { assumedRole: true } : {}),
      };
    case "system":
      return { type: "system", id: user.id };
  }
  // Fail closed for legacy stored documents with an unrecognized type.
  return undefined;
}
