import {
  auditUserToEventUser,
  eventUserCredit,
  eventUserLabel,
  eventUserPersonId,
  reviewerKeyForEventUser,
  type EventUser,
} from "../../src/validators";

const dana = { id: "u_dana", name: "Dana", email: "dana@example.com" };

const actors: Record<string, EventUser> = {
  "a signed-in member": { type: "dashboard", ...dana },
  "a personal access token": { type: "api_key", apiKey: "key_pat", ...dana },
  "an org key naming Dana": {
    type: "api_key",
    apiKey: "key_ci",
    name: "CI key",
    requestedBy: dana,
  },
  "an org key naming no one": {
    type: "api_key",
    apiKey: "key_ci",
    name: "CI key",
  },
  "a nameless org key": { type: "api_key", apiKey: "key_ci" },
  "the system": { type: "system", id: "sys" },
  "no actor": null,
};

describe("actor helpers", () => {
  it.each([
    // actor, person id, reviewer key, label, label with email, credit
    [
      "a signed-in member",
      "u_dana",
      "u_dana",
      "Dana",
      "Dana (dana@example.com)",
      dana,
    ],
    [
      "a personal access token",
      "u_dana",
      "u_dana",
      "Dana (API)",
      "Dana (dana@example.com) (API)",
      dana,
    ],
    [
      "an org key naming Dana",
      "u_dana",
      "u_dana",
      "Dana via CI key",
      "Dana (dana@example.com) via CI key",
      dana,
    ],
    [
      "an org key naming no one",
      null,
      "key_ci",
      "CI key (API)",
      "CI key (API)",
      { name: "CI key" },
    ],
    ["a nameless org key", null, "key_ci", "API key", "API key", {}],
    ["the system", null, null, "System", "System", {}],
    ["no actor", null, null, "", "", {}],
  ] as const)(
    "credit %s",
    (actor, personId, reviewerKey, label, labelWithEmail, credit) => {
      const user = actors[actor];
      expect(eventUserPersonId(user)).toBe(personId);
      expect(reviewerKeyForEventUser(user)).toBe(reviewerKey);
      expect(eventUserLabel(user)).toBe(label);
      expect(eventUserLabel(user, { withEmail: true })).toBe(labelWithEmail);
      expect(eventUserCredit(user)).toEqual(credit);
    },
  );

  it("labels a member by their current name when one is supplied", () => {
    const nameFor = (id: string) => (id === "u_dana" ? "Dana Q" : undefined);
    expect(eventUserLabel(actors["an org key naming Dana"], { nameFor })).toBe(
      "Dana Q via CI key",
    );
    expect(eventUserLabel(actors["a signed-in member"], { nameFor })).toBe(
      "Dana Q",
    );
  });

  it.each([
    [
      "an org key naming Dana",
      { apiKey: "key_ci", name: "CI key", requestedBy: dana },
      actors["an org key naming Dana"],
    ],
    [
      "a personal access token",
      { apiKey: "key_pat", ...dana },
      actors["a personal access token"],
    ],
    ["a signed-in member", dana, actors["a signed-in member"]],
    ["the system", { system: true as const }, { type: "system" }],
  ])("reads %s back from an audit entry", (_, auditUser, expected) => {
    expect(auditUserToEventUser(auditUser)).toEqual(
      expect.objectContaining(expected),
    );
  });
});
