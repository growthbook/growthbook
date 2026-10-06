import { ApiKeyInterface } from "shared/types/apikey";
import { OrganizationInterface } from "shared/types/organization";
import { RequestedByPolicy } from "shared/validators";
import {
  isApiKeyForUserInOrganization,
  migrateApiKey,
  roleForApiKey,
  resolveRequestedBy,
  assertRequestedByAllowed,
  assertNoRequestedByOnUserToken,
} from "back-end/src/util/api-key.util";

describe("api key utils", () => {
  describe("isApiKeyForUserInOrganization", () => {
    it("should return true when a user is in an org", () => {
      const apiKey: Partial<ApiKeyInterface> = {
        userId: "user-abc123",
      };
      const org: Partial<OrganizationInterface> = {
        members: [
          {
            environments: [],
            id: "user-abc123",
            role: "admin",
            limitAccessByEnvironment: true,
          },
        ],
      };

      const result = isApiKeyForUserInOrganization(apiKey, org);

      expect(result).toEqual(true);
    });

    it("should return false when a user is not in an org", () => {
      const apiKey: Partial<ApiKeyInterface> = {
        userId: "user-xyz789",
      };
      const org: Partial<OrganizationInterface> = {
        members: [
          {
            environments: [],
            id: "user-abc123",
            role: "admin",
            limitAccessByEnvironment: true,
          },
          {
            environments: [],
            id: "user-def456",
            role: "readonly",
            limitAccessByEnvironment: true,
          },
        ],
      };

      const result = isApiKeyForUserInOrganization(apiKey, org);

      expect(result).toEqual(false);
    });

    it("should return false when an invalid API key is provided", () => {
      const apiKey: Partial<ApiKeyInterface> = {
        id: "key_712578938",
      };
      const org: Partial<OrganizationInterface> = {
        members: [
          {
            environments: [],
            id: "user-abc123",
            role: "admin",
            limitAccessByEnvironment: true,
          },
          {
            environments: [],
            id: "user-def456",
            role: "readonly",
            limitAccessByEnvironment: true,
          },
        ],
      };

      const result = isApiKeyForUserInOrganization(apiKey, org);

      expect(result).toEqual(false);
    });

    it("should return false when an invalid organization is provided", () => {
      const apiKey: Partial<ApiKeyInterface> = {
        userId: "user-abc123",
      };
      const org: Partial<OrganizationInterface> = {};

      const result = isApiKeyForUserInOrganization(apiKey, org);

      expect(result).toEqual(false);
    });
  });

  describe("roleForApiKey", () => {
    it("should return admin for secret keys without roles", () => {
      const input: Pick<ApiKeyInterface, "role" | "userId" | "secret"> = {
        role: undefined,
        userId: undefined,
        secret: true,
      };

      expect(roleForApiKey(input)).toEqual("admin");
    });

    it("should return null for non-secret keys", () => {
      const input: Pick<ApiKeyInterface, "role" | "userId" | "secret"> = {
        role: undefined,
        userId: undefined,
        secret: false,
      };

      expect(roleForApiKey(input)).toEqual(null);
    });

    it("should return null for secret keys with user IDs", () => {
      const input: Pick<ApiKeyInterface, "role" | "userId" | "secret"> = {
        role: undefined,
        userId: "user-abc123",
        secret: true,
      };

      expect(roleForApiKey(input)).toEqual(null);
    });

    it("should return readonly for secret keys with readonly specified", () => {
      const input: Pick<ApiKeyInterface, "role" | "userId" | "secret"> = {
        role: "readonly",
        userId: undefined,
        secret: true,
      };

      expect(roleForApiKey(input)).toEqual("readonly");
    });
  });

  describe("migrateApiKey", () => {
    it("should strip the role from every user-attributed key", () => {
      for (const role of ["user", "visualEditor"]) {
        const migrated = migrateApiKey({
          userId: "user-abc123",
          role,
          secret: true,
          dateCreated: new Date(),
        });

        expect(migrated.role).toBeUndefined();
      }
    });

    it("should still default a roleless org secret key to admin", () => {
      const migrated = migrateApiKey({
        role: undefined,
        secret: true,
        dateCreated: new Date(),
      });

      expect(migrated.role).toEqual("admin");
    });
  });
});

const org = {
  members: [
    { id: "u_alice", teams: ["t_growth"] },
    { id: "u_bob", teams: [] },
  ],
} as unknown as OrganizationInterface;

describe("resolveRequestedBy", () => {
  const users = [
    { id: "u_alice", name: "Alice", email: "alice@example.com" },
    { id: "u_bob", name: "", email: "bob@example.com" },
    { id: "u_outsider", name: "Out", email: "out@example.com" },
  ];
  const lookup = {
    byId: async (id: string) => users.find((u) => u.id === id) ?? null,
    byEmail: async (email: string) =>
      users.find((u) => u.email === email.toLowerCase()) ?? null,
  };

  it("returns null when the header is absent or blank", async () => {
    expect(await resolveRequestedBy(undefined, org, lookup)).toBeNull();
    expect(await resolveRequestedBy("  ", org, lookup)).toBeNull();
  });

  it("matches a member by user id, or by email case-insensitively", async () => {
    expect(await resolveRequestedBy("u_alice", org, lookup)).toEqual({
      id: "u_alice",
      name: "Alice",
      email: "alice@example.com",
    });
    expect(await resolveRequestedBy("Bob@Example.com", org, lookup)).toEqual({
      id: "u_bob",
      name: "",
      email: "bob@example.com",
    });
  });

  it("uses the first value when the header repeats", async () => {
    const member = await resolveRequestedBy(["u_alice", "u_bob"], org, lookup);
    expect(member?.id).toBe("u_alice");
  });

  it.each(["out@example.com", "nobody"])(
    "refuses %s, who is not a member, with a 400",
    async (value) => {
      await expect(
        resolveRequestedBy(value, org, lookup),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
});

describe("assertRequestedByAllowed", () => {
  const alice = { id: "u_alice", name: "Alice", email: "alice@example.com" };
  const bob = { id: "u_bob", name: "", email: "bob@example.com" };
  const policy = (overrides: Partial<RequestedByPolicy> = {}) => ({
    mode: "optional" as const,
    limitToRequester: false,
    memberIds: [],
    teamIds: [],
    ...overrides,
  });
  const check = (p: RequestedByPolicy, member: typeof alice | null) => {
    try {
      assertRequestedByAllowed(p, member, org);
      return "ok";
    } catch (e) {
      return e.status;
    }
  };

  it.each([
    ["optional, no header", policy(), null, "ok"],
    ["required, no header", policy({ mode: "required" }), null, 400],
    ["off, header sent", policy({ mode: "off" }), alice, 403],
    ["off, no header", policy({ mode: "off" }), null, "ok"],
    ["any member allowed", policy(), bob, "ok"],
    ["member listed", policy({ memberIds: ["u_bob"] }), bob, "ok"],
    ["member in a listed team", policy({ teamIds: ["t_growth"] }), alice, "ok"],
    ["member outside the lists", policy({ teamIds: ["t_growth"] }), bob, 403],
  ] as const)("%s", (_, p, member, expected) => {
    expect(check(p, member)).toBe(expected);
  });
});

describe("assertNoRequestedByOnUserToken", () => {
  it("allows a request without the header and refuses one with it", () => {
    expect(() => assertNoRequestedByOnUserToken(undefined)).not.toThrow();
    expect(() => assertNoRequestedByOnUserToken("alice@example.com")).toThrow(
      "only for organization API keys",
    );
  });
});
