import { reviewerKeyForEventUser } from "../../src/validators";

const member = { id: "u_asker", name: "Asker", email: "asker@example.com" };

describe("reviewerKeyForEventUser", () => {
  it.each([
    [
      "a signed-in member",
      { type: "dashboard", id: "u_me", email: "", name: "" },
      "u_me",
    ],
    [
      "a personal token's owner",
      { type: "api_key", apiKey: "key_pat", id: "u_owner" },
      "u_owner",
    ],
    [
      "the member an org key names",
      { type: "api_key", apiKey: "key_org", requestedBy: member },
      "u_asker",
    ],
    [
      "an org key that names no one",
      { type: "api_key", apiKey: "key_org" },
      "key_org",
    ],
    ["nobody for a system actor", { type: "system", id: "sys" }, null],
  ] as const)("is %s", (_, user, expected) => {
    expect(reviewerKeyForEventUser(user)).toBe(expected);
  });
});
