import {
  auditUserToEventUser,
  eventUserCredit,
  eventUserLabel,
  eventUserPersonId,
  eventUserIdentity,
  type EventUser,
} from "../../src/validators";

const dana = { id: "u_dana", name: "Dana", email: "dana@example.com" };

const actors: Record<string, EventUser> = {
  "a signed-in member": { type: "dashboard", ...dana },
  "a personal access token": { type: "api_key", apiKey: "key_pat", ...dana },
  "an org key assuming Dana's role": {
    type: "api_key",
    apiKey: "key_ci",
    name: "CI key",
    requestedBy: dana,
    assumedRole: true,
  },
  "an org key naming Dana as itself": {
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
    // actor, person id, identity, label, label with email, credit
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
      "an org key assuming Dana's role",
      "u_dana",
      "u_dana",
      "Dana via CI key",
      "Dana (dana@example.com) via CI key",
      dana,
    ],
    [
      "an org key naming Dana as itself",
      null,
      "key_ci",
      "Dana via CI key",
      "Dana (dana@example.com) via CI key",
      { name: "CI key" },
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
    (actor, personId, identity, label, labelWithEmail, credit) => {
      const user = actors[actor];
      expect(eventUserPersonId(user)).toBe(personId);
      expect(eventUserIdentity(user)).toBe(identity);
      expect(eventUserLabel(user)).toBe(label);
      expect(eventUserLabel(user, { withEmail: true })).toBe(labelWithEmail);
      expect(eventUserCredit(user)).toEqual(credit);
    },
  );

  it("labels a member by their current name when one is supplied", () => {
    const nameFor = (id: string) => (id === "u_dana" ? "Dana Q" : undefined);
    expect(
      eventUserLabel(actors["an org key assuming Dana's role"], { nameFor }),
    ).toBe("Dana Q via CI key");
    expect(eventUserLabel(actors["a signed-in member"], { nameFor })).toBe(
      "Dana Q",
    );
  });

  it.each([
    [
      "an org key assuming Dana's role",
      {
        apiKey: "key_ci",
        name: "CI key",
        requestedBy: dana,
        assumedRole: true,
      },
      actors["an org key assuming Dana's role"],
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

  describe("identity", () => {
    const key = (apiKey: string, assumedRole: boolean): EventUser => ({
      type: "api_key",
      apiKey,
      name: apiKey,
      requestedBy: dana,
      ...(assumedRole && { assumedRole: true }),
    });
    const callers: [string, EventUser][] = [
      ["Dana in the app", { type: "dashboard", ...dana }],
      ["Key assuming Dana", key("key_1", true)],
      ["Key alone", { type: "api_key", apiKey: "key_1", name: "Key" }],
      ["Key naming Dana", key("key_1", false)],
      ["Key2 assuming Dana", key("key_2", true)],
      ["Key2 naming Dana", key("key_2", false)],
    ];
    // Rows ask, columns made the draft: a key is its own identity until it
    // assumes a member's role, then it is that member.
    const SAME = [
      [1, 1, 0, 0, 1, 0],
      [1, 1, 0, 0, 1, 0],
      [0, 0, 1, 1, 0, 0],
      [0, 0, 1, 1, 0, 0],
      [1, 1, 0, 0, 1, 0],
      [0, 0, 0, 0, 0, 1],
    ];

    it.each(callers.map(([name], i) => [name, i]))(
      "matches %s only to the identities it acts as",
      (_, row) => {
        const asker = eventUserIdentity(callers[row][1]);
        expect(
          callers.map(([, maker]) =>
            Number(asker === eventUserIdentity(maker)),
          ),
        ).toEqual(SAME[row]);
      },
    );
  });
});
