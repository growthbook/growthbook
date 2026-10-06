import { ApiKeyInterface } from "shared/types/apikey";
import { OrganizationInterface } from "shared/types/organization";
import {
  isApiKeyForUserInOrganization,
  migrateApiKey,
  roleForApiKey,
  resolveOnBehalfOf,
  assertOnBehalfOfIsTokenUser,
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

describe("resolveOnBehalfOf", () => {
  const org = {
    members: [{ id: "u_alice" }, { id: "u_bob" }],
  } as unknown as OrganizationInterface;
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
    expect(await resolveOnBehalfOf(undefined, org, lookup)).toBeNull();
    expect(await resolveOnBehalfOf("  ", org, lookup)).toBeNull();
  });

  it("matches a member by user id", async () => {
    expect(await resolveOnBehalfOf("u_alice", org, lookup)).toEqual({
      id: "u_alice",
      name: "Alice",
      email: "alice@example.com",
    });
  });

  it("matches a member by email, case-insensitively, and blanks a missing name", async () => {
    expect(await resolveOnBehalfOf("Bob@Example.com", org, lookup)).toEqual({
      id: "u_bob",
      name: "",
      email: "bob@example.com",
    });
  });

  it("uses the first value when the header repeats", async () => {
    const member = await resolveOnBehalfOf(["u_alice", "u_bob"], org, lookup);
    expect(member?.id).toBe("u_alice");
  });

  it("refuses a user who is not a member and an unknown value", async () => {
    await expect(
      resolveOnBehalfOf("out@example.com", org, lookup),
    ).rejects.toThrow("does not match a member");
    await expect(resolveOnBehalfOf("nobody", org, lookup)).rejects.toThrow(
      "does not match a member",
    );
  });
});

describe("assertOnBehalfOfIsTokenUser", () => {
  const user = { id: "u_alice", email: "alice@example.com" };

  it("allows an absent header or the token's own user", () => {
    expect(() => assertOnBehalfOfIsTokenUser(undefined, user)).not.toThrow();
    expect(() => assertOnBehalfOfIsTokenUser("u_alice", user)).not.toThrow();
    expect(() =>
      assertOnBehalfOfIsTokenUser("Alice@Example.com", user),
    ).not.toThrow();
  });

  it("refuses anyone else", () => {
    expect(() => assertOnBehalfOfIsTokenUser("u_bob", user)).toThrow(
      "personal access token",
    );
  });
});
