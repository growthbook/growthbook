import { ApiKeyInterface } from "shared/types/apikey";
import { OrganizationInterface } from "shared/types/organization";
import {
  isApiKeyForUserInOrganization,
  isUserAccessToken,
  migrateApiKey,
  roleForApiKey,
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

  describe("isUserAccessToken", () => {
    it("should return true for a personal access token", () => {
      expect(isUserAccessToken({ userId: "user-abc123", role: "user" })).toBe(
        true,
      );
    });

    it("should return true for a PAT whose role was stripped on read", () => {
      expect(
        isUserAccessToken({ userId: "user-abc123", role: undefined }),
      ).toBe(true);
    });

    it("should return false for an app-issued Visual Editor key", () => {
      expect(
        isUserAccessToken({ userId: "user-abc123", role: "visualEditor" }),
      ).toBe(false);
    });

    it("should return false for an org API key", () => {
      expect(isUserAccessToken({ userId: undefined, role: "admin" })).toBe(
        false,
      );
    });
  });

  describe("migrateApiKey", () => {
    it("should strip the role from a personal access token", () => {
      const migrated = migrateApiKey({
        userId: "user-abc123",
        role: "user",
        secret: true,
        dateCreated: new Date(),
      });

      expect(migrated.role).toBeUndefined();
    });

    it("should keep the role on an app-issued Visual Editor key", () => {
      const migrated = migrateApiKey({
        userId: "user-abc123",
        role: "visualEditor",
        secret: true,
        dateCreated: new Date(),
      });

      expect(migrated.role).toEqual("visualEditor");
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
