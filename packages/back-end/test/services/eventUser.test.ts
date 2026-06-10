import {
  eventUserToApiEventUser,
  legacyUserIdToApiEventUser,
} from "back-end/src/services/event-user";

describe("legacyUserIdToApiEventUser", () => {
  it("returns undefined for empty or missing userIds (org-scoped API key drafts)", () => {
    expect(legacyUserIdToApiEventUser(undefined)).toBeUndefined();
    expect(legacyUserIdToApiEventUser("")).toBeUndefined();
  });

  it("maps a u_ id with a usersById hit to a dashboard user with name/email", () => {
    const usersById = new Map([
      ["u_abc", { name: "Jane Doe", email: "jane@example.com" }],
    ]);
    expect(legacyUserIdToApiEventUser("u_abc", usersById)).toEqual({
      type: "dashboard",
      id: "u_abc",
      name: "Jane Doe",
      email: "jane@example.com",
    });
  });

  it("maps a u_ id with no usersById hit to a dashboard user with id only", () => {
    expect(legacyUserIdToApiEventUser("u_gone", new Map())).toEqual({
      type: "dashboard",
      id: "u_gone",
    });
    expect(legacyUserIdToApiEventUser("u_gone")).toEqual({
      type: "dashboard",
      id: "u_gone",
    });
  });

  it("maps an email-shaped value to a dashboard user with email only", () => {
    expect(legacyUserIdToApiEventUser("owner@example.com")).toEqual({
      type: "dashboard",
      email: "owner@example.com",
    });
  });

  it("maps a display-name value (backfilled entity.owner) to a dashboard user with name only", () => {
    expect(legacyUserIdToApiEventUser("Jane Doe")).toEqual({
      type: "dashboard",
      name: "Jane Doe",
    });
  });

  it("never emits an apiKey field", () => {
    const mapped = legacyUserIdToApiEventUser("u_abc", new Map());
    expect(mapped).not.toHaveProperty("apiKey");
  });
});

describe("eventUserToApiEventUser (re-exported from event-user)", () => {
  it("strips the api_key actor's apiKey field", () => {
    const mapped = eventUserToApiEventUser({
      type: "api_key",
      apiKey: "key_secret",
      id: "u_2",
      name: "CI Bot",
    });
    expect(mapped).toEqual({ type: "api_key", id: "u_2", name: "CI Bot" });
    expect(mapped).not.toHaveProperty("apiKey");
  });
});
