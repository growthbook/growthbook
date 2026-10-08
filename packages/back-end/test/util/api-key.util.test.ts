import { ApiKeyInterface } from "shared/types/apikey";
import { OrganizationInterface } from "shared/types/organization";
import {
  isApiKeyForUserInOrganization,
  migrateApiKey,
  roleForApiKey,
  resolveRequestedBy,
  resolveRequestedByFor,
  encodeArmingApiKeyId,
  decodeArmingApiKeyId,
  apiKeyEventUser,
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

    it("should keep the cap role on a scoped PAT", () => {
      const migrated = migrateApiKey({
        userId: "user-abc123",
        role: "readonly",
        scoped: true,
        secret: true,
        dateCreated: new Date(),
      });

      expect(migrated.role).toEqual("readonly");
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
  members: [{ id: "u_alice" }, { id: "u_bob" }],
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
      users.find((u) => u.email === email) ?? null,
  };

  it("returns null when the header is absent or blank", async () => {
    expect(await resolveRequestedBy(undefined, org, lookup)).toBeNull();
    expect(await resolveRequestedBy("  ", org, lookup)).toBeNull();
  });

  it("matches a member by user id or email", async () => {
    expect(await resolveRequestedBy("u_alice", org, lookup)).toEqual({
      id: "u_alice",
      name: "Alice",
      email: "alice@example.com",
    });
    expect(await resolveRequestedBy("bob@example.com", org, lookup)).toEqual({
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

  // Each key policy is covered through the auth middleware in attribution-matrix.
  it("lets a token through without the header", async () => {
    await expect(
      resolveRequestedByFor(undefined, null, org, lookup),
    ).resolves.toBeNull();
  });
});

describe("arming API key ids", () => {
  it("leaves a key without a requester as its bare id", () => {
    expect(encodeArmingApiKeyId("key_abc", undefined)).toBe("key_abc");
    expect(decodeArmingApiKeyId("key_abc")).toEqual({
      apiKeyId: "key_abc",
      requesterId: null,
    });
  });

  it("round-trips the requester alongside the key", () => {
    const id = encodeArmingApiKeyId("key_abc", "u_123");
    expect(id).toBe("key_abc:u_123");
    expect(decodeArmingApiKeyId(id)).toEqual({
      apiKeyId: "key_abc",
      requesterId: "u_123",
    });
  });
});

describe("apiKeyEventUser", () => {
  const dana = { id: "u_dana", name: "Dana", email: "dana@example.com" };
  const key = { description: "CI key" };

  it.each([
    ["assumes their role", key, true],
    [
      "keeps its own role",
      { ...key, requesterPermissions: "key" as const },
      false,
    ],
  ])("records an org key naming a member that %s", (_, apiKey, assumed) => {
    expect(
      apiKeyEventUser({
        apiKeyId: "key_ci",
        key: apiKey,
        owner: null,
        requester: dana,
      }),
    ).toEqual({
      type: "api_key",
      apiKey: "key_ci",
      name: "CI key",
      requestedBy: dana,
      ...(assumed ? { assumedRole: true } : {}),
    });
  });

  it("records an org key that names no one under its own name", () => {
    expect(
      apiKeyEventUser({
        apiKeyId: "key_ci",
        key,
        owner: null,
        requester: null,
      }),
    ).toEqual({ type: "api_key", apiKey: "key_ci", name: "CI key" });
  });

  it("records a personal access token as its owner", () => {
    expect(
      apiKeyEventUser({
        apiKeyId: "key_pat",
        key,
        owner: dana,
        requester: null,
      }),
    ).toEqual({ type: "api_key", apiKey: "key_pat", ...dana });
  });
});
