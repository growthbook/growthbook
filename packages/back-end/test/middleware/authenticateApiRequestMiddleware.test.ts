import { Request, Response } from "express";
import { getRolePermissions } from "shared/permissions";
import { ApiKeyInterface } from "shared/types/apikey";
import { OrganizationInterface, Permission } from "shared/types/organization";
import authenticateApiRequestMiddleware, {
  verifyApiKeyPermission,
} from "back-end/src/middleware/authenticateApiRequestMiddleware";
import { dangerousLookupOrganizationByApiKey } from "back-end/src/util/api-key.util";
import { ApiRequestLocals } from "back-end/types/api";

jest.mock("back-end/src/util/api-key.util", () => ({
  ...jest.requireActual("back-end/src/util/api-key.util"),
  dangerousLookupOrganizationByApiKey: jest.fn(),
}));

jest.mock("back-end/src/models/ApiKeyModel", () => ({
  ApiKeyModel: { dangerousRecordUsageByKey: jest.fn(() => Promise.resolve()) },
}));

describe("REST API auth middleware", () => {
  describe("verifyApiKeyPermission", () => {
    const collaboratorId = "u_sktwiz68la1ju2g3";
    const orgId = "org_sktwi1id9l7z9xkjb";
    const organization: OrganizationInterface = {
      dateCreated: new Date(),
      id: orgId,
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
          id: collaboratorId,
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
      organization: orgId,
      key: "secret_abc123456789xyz987654321",
      encryptSDK: false,
      description: "my all access key",
      role: "admin", // this is added in the "JIT migration"
    };
    const readOnlyKey: Partial<ApiKeyInterface> = {
      id: "key_sktwiqiglh85h2k8",
      secret: true,
      organization: orgId,
      key: "secret_read-only_abc123456789xyz987654321",
      encryptSDK: false,
      role: "readonly",
      description: "My test readonly key created in the REPL",
    };
    const userKey: Partial<ApiKeyInterface> = {
      id: "key_sktwiqiglh85h2k8",
      secret: true,
      organization: orgId,
      key: "secret_read-only_abc123456789xyz987654321",
      encryptSDK: false,
      userId: collaboratorId,
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
        superAdmin: false,
      });
    });

    it("should throw for every permission on a traceIngest key", () => {
      const traceIngestKey: Partial<ApiKeyInterface> = {
        id: "key_traceingest",
        secret: true,
        organization: orgId,
        key: "secret_traceIngest_abc123",
        encryptSDK: false,
        role: "traceIngest",
        description: "AI traces",
      };
      const permissions: Permission[] = [
        "readData",
        "createMetrics",
        "editFeatureDrafts",
        "manageApiKeys",
      ];
      for (const permission of permissions) {
        for (const project of [undefined, "prj_abc123"]) {
          expect(() =>
            verifyApiKeyPermission({
              apiKey: traceIngestKey,
              permission,
              organization,
              environments: ["production"],
              project,
              teams: [],
              superAdmin: false,
            }),
          ).toThrow("API key user does not have this level of access");
        }
      }
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
          superAdmin: false,
        });
      }).toThrowError();
    });

    it("judges an org key by its per-request permissions when given", () => {
      const check = (apiKey: Partial<ApiKeyInterface>, role: string) => () =>
        verifyApiKeyPermission({
          apiKey,
          permission: "createMetrics",
          organization,
          teams: [],
          superAdmin: false,
          keyPermissions: getRolePermissions(
            { role, limitAccessByEnvironment: false, environments: [] },
            organization,
            [],
          ),
        });
      expect(check(readOnlyKey, "admin")).not.toThrow();
      expect(check(secretFullAccessKey, "readonly")).toThrow();
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
          superAdmin: false,
        });
      }).toThrowError();
    });

    it("should allow keys with the right level of environment access", () => {
      const permission: Permission = "createPresentations";
      const project = undefined;
      const environments = ["production"];

      verifyApiKeyPermission({
        apiKey: userKey,
        permission,
        organization,
        environments,
        project,
        teams: [],
        superAdmin: false,
      });
    });

    it("should allow keys with the right level of environment access when multiple envs are passed in", () => {
      const permission: Permission = "createPresentations";
      const project = undefined;
      const environments = ["production", "staging"];

      verifyApiKeyPermission({
        apiKey: userKey,
        permission,
        organization,
        environments,
        project,
        teams: [],
        superAdmin: false,
      });
    });

    it("should throw an error for user API keys where the user does not have access to the project", () => {
      const permission: Permission = "editFeatureDrafts";
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
          superAdmin: false,
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
          superAdmin: false,
        });
      }).toThrowError();
    });

    it("should throw an error when user is not part of an org", () => {
      const permission: Permission = "readData";
      const project = undefined;
      const environments = ["production", "staging"];

      expect(() => {
        verifyApiKeyPermission({
          apiKey: {
            ...userKey,
            userId: "u_unknown_id",
          },
          permission,
          organization,
          environments,
          project,
          teams: [],
          superAdmin: false,
        });
      }).toThrowError();
    });

    it("should allow superAdmins to readData but not other permissions when they are not part of an org", () => {
      const permission: Permission = "readData";
      const project = undefined;
      const environments = ["production", "staging"];

      verifyApiKeyPermission({
        apiKey: {
          ...userKey,
          userId: "u_unknown_id",
        },
        permission,
        organization,
        environments,
        project,
        teams: [],
        superAdmin: true,
      });

      expect(() => {
        verifyApiKeyPermission({
          apiKey: {
            ...userKey,
            userId: "u_unknown_id",
          },
          permission: "createMetrics",
          organization,
          environments,
          project,
          teams: [],
          superAdmin: true,
        });
      }).toThrowError();
    });

    it("should allow superAdmins their roles' permissions and only those permissions if they are part of the org", () => {
      const permission: Permission = "createPresentations";
      const project = undefined;
      const environments = ["production"];

      verifyApiKeyPermission({
        apiKey: userKey,
        permission,
        organization,
        environments,
        project,
        teams: [],
        superAdmin: true,
      });

      const permission2: Permission = "createMetrics";
      expect(() => {
        verifyApiKeyPermission({
          apiKey: userKey,
          permission: permission2,
          organization,
          environments,
          project,
          teams: [],
          superAdmin: true,
        });
      }).toThrowError();
    });
  });
});

describe("authenticateApiRequestMiddleware with an API key", () => {
  const run = async (apiKeyDoc: Partial<ApiKeyInterface>) => {
    jest
      .mocked(dangerousLookupOrganizationByApiKey)
      .mockResolvedValue(apiKeyDoc as ApiKeyInterface);

    const next = jest.fn();
    let resolve: () => void = () => undefined;
    const responded = new Promise<void>((r) => (resolve = r));
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(() => resolve()),
    };
    const req = {
      headers: { authorization: `Bearer ${apiKeyDoc.key}` },
      log: { warn: jest.fn(), child: jest.fn() },
    };
    authenticateApiRequestMiddleware(
      req as unknown as Request & ApiRequestLocals,
      res as unknown as Response & { log: Request["log"] },
      next,
    );
    await responded;
    return { res, next };
  };

  it("rejects a traceIngest key before it reaches any handler", async () => {
    const { res, next } = await run({
      id: "key_1",
      key: "secret_traceIngest_abc",
      secret: true,
      organization: "org_1",
      role: "traceIngest",
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      message:
        "This API key has the traceIngest role and can't be used with the GrowthBook API",
    });
  });

  it("rejects a token carrying traceIngest even if it's user-attributed", async () => {
    const { res, next } = await run({
      id: "key_2",
      key: "secret_user_abc",
      secret: true,
      organization: "org_1",
      userId: "u_1",
      scoped: true,
      role: "traceIngest",
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
