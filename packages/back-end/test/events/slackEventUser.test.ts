import { getEventUserFormatted } from "back-end/src/events/handlers/slack/slack-event-handler-utils";

const dana = { id: "u_dana", name: "Dana", email: "dana@example.com" };

describe("getEventUserFormatted", () => {
  it.each([
    [
      "a signed-in member",
      { type: "dashboard", ...dana },
      "Dana (dana@example.com)",
    ],
    [
      "a personal access token",
      { type: "api_key", apiKey: "key_pat", ...dana },
      "Dana (dana@example.com) (API)",
    ],
    [
      "an org key naming Dana",
      { type: "api_key", apiKey: "key_ci", name: "CI key", requestedBy: dana },
      "Dana (dana@example.com) via CI key",
    ],
    [
      "an org key naming no one",
      { type: "api_key", apiKey: "key_ci", name: "CI key" },
      "CI key (API)",
    ],
    [
      "a nameless org key",
      { type: "api_key", apiKey: "key_abcd1234" },
      "an API request with key ending in ...1234",
    ],
    ["the system", { type: "system" }, "an automated process"],
    ["no actor", undefined, "an unknown user"],
  ] as const)("credits %s", (_, user, expected) => {
    expect(getEventUserFormatted(user)).toBe(expected);
  });
});
