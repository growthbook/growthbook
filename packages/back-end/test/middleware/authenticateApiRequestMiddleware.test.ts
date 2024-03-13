import { ApiKeyInterface } from "@/types/apikey";
import { verifyApiKeyPermission } from "@/src/middleware/authenticateApiRequestMiddleware";
import { OrganizationInterface, Permission } from "@/types/organization";

describe("REST API auth middleware", () => {
  describe("verifyApiKeyPermission", () => {
    const organization: OrganizationInterface = {
      dateCreated: undefined,
      id: "org_sktwi1id9l7z9xkjb",
      invites: [],
      name: "Main Org",
      ownerEmail: "",
      url: "",
      members: [
        {
          environments: [],
          limitAccessByEnvironment: false,
          id: "u_sktwi1id9l7z9xkis",
          role: "admin",
          projectRoles: [],
        },
        {
          environments: [],
          id: "u_sktwiz68la1ju2g3",
          role: "collaborator",
          limitAccessByEnvironment: false,
          projectRoles: [],
        },
        {
          environments: ["staging"],
          id: "u_anotheruser456",
          role: "engineer",
          limitAccessByEnvironment: true,
          projectRoles: [
            {
              project: "prj_abc123",
              role: "engineer",
              limitAccessByEnvironment: true,
              environments: ["production"],
            },
          ],
        },
        {
          environments: ["production"],
          id: "u_anotheruser789",
          role: "experimenter",
          limitAccessByEnvironment: false,
          projectRoles: [],
        },
      ],
      settings: {
        environments: [{ id: "staging" }, { id: "production" }],
      },
    };

    // API keys
    const secretFullAccessKey: Partial<ApiKeyInterface> = {
      id: "key_sktwitxylfhahyil",
      secret: true,
      environment: "production",
      organization: "org_sktwi1id9l7z9xkjb",
      key: "secret_abc123456789xyz987654321",
      encryptSDK: false,
      description: "my all access key",
      role: "admin", // this is added in the "JIT migration"
    };
    const readOnlyKey: Partial<ApiKeyInterface> = {
      id: "key_sktwiqiglh85h2k8",
      secret: true,
      organization: "org_sktwi1id9l7z9xkjb",
      key: "secret_read-only_abc123456789xyz987654321",
      encryptSDK: false,
      role: "readonly",
      description: "My test readonly key created in the REPL",
    };
    const userKey: Partial<ApiKeyInterface> = {
      id: "key_sktwiqiglh85h2k8",
      secret: true,
      organization: "org_sktwi1id9l7z9xkjb",
      key: "secret_read-only_abc123456789xyz987654321",
      encryptSDK: false,
      userId: "u_sktwi1id9l7z9xkis",
      description: "My user key created in the REPL",
    };

    it("should allow anything for the full-access API keys", () => {
      const permission: Permission = "createMetrics";
      const project = "prj_abc123";
      const environments = ["production"];

      verifyApiKeyPermission({
        apiKey: secretFullAccessKey,
        permission,
        organization,
        environments,
        project,
        teams: [],
      });
    });

    it("should throw an error for read-only API keys", () => {
      const permission: Permission = "createMetrics";
      const project = undefined;
      const environments = undefined;

      expect(() => {
        verifyApiKeyPermission({
          apiKey: readOnlyKey,
          permission,
          organization,
          environments,
          project,
          teams: [],
        });
      }).toThrowError();
    });

    it("should throw an error for user API keys where the user does not have access to the environment", () => {
      const permission: Permission = "createMetrics";
      const project = undefined;
      const environments = ["production"];

      expect(() => {
        verifyApiKeyPermission({
          apiKey: {
            ...userKey,
            userId: "u_anotheruser456",
          },
          permission,
          organization,
          environments,
          project,
          teams: [],
        });
      }).toThrowError();
    });

    it("should allow keys with the right level of environment access", () => {
      const permission: Permission = "createMetrics";
      const project = undefined;
      const environments = ["production"];

      verifyApiKeyPermission({
        apiKey: userKey,
        permission,
        organization,
        environments,
        project,
        teams: [],
      });
    });

    it("should allow keys with the right level of environment access when multiple envs are passed in", () => {
      const permission: Permission = "createMetrics";
      const project = undefined;
      const environments = ["production", "staging"];

      verifyApiKeyPermission({
        apiKey: userKey,
        permission,
        organization,
        environments,
        project,
        teams: [],
      });
    });

    it("should throw an error for user API keys where the user does not have access to the project", () => {
      const permission: Permission = "manageFeatures";
      const project = "prj_xyz987";
      const environments = ["production"];

      expect(() => {
        verifyApiKeyPermission({
          apiKey: {
            ...userKey,
            userId: "u_anotheruser456",
          },
          permission,
          organization,
          environments,
          project,
          teams: [],
        });
      }).toThrowError();
    });

    it("should throw an error for user API keys when the user doesn't access to all environments passed in", () => {
      const permission: Permission = "runExperiments";
      const project = undefined;
      const environments = ["production", "staging"];

      expect(() => {
        verifyApiKeyPermission({
          apiKey: {
            ...userKey,
            userId: "u_anotheruser456",
          },
          permission,
          organization,
          environments,
          project,
          teams: [],
        });
      }).toThrowError();
    });
  });
});
