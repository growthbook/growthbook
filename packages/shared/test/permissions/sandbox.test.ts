import {
  OrganizationInterface,
  OrganizationSandbox,
  UserPermissions,
} from "shared/types/organization";
import {
  SANDBOX_POLICIES,
  getActiveSandboxPolicy,
  removePermissions,
} from "../../src/permissions/sandbox";
import { getRolePermissions } from "../../src/permissions/resolveUserPermissions";
import { hasPermission } from "../../src/permissions/permissions.utils";

const admin = {
  role: "admin",
  limitAccessByEnvironment: false,
  environments: [],
};

function sandboxOrg(
  sandbox?: Partial<OrganizationSandbox>,
): OrganizationInterface {
  return {
    id: "org_sandbox",
    name: "acme-web",
    url: "",
    ownerEmail: "",
    dateCreated: new Date(),
    members: [],
    invites: [],
    settings: {
      environments: [
        { id: "production", description: "" },
        { id: "dev", description: "" },
      ],
    },
    ...(sandbox
      ? {
          sandbox: {
            kind: "agent-signup",
            status: "active",
            expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
            source: { runId: "arun_1", apiKeyId: "key_1" },
            codeHash: "hash",
            ...sandbox,
          },
        }
      : {}),
  };
}

describe("getActiveSandboxPolicy", () => {
  it("applies only while the sandbox is active", () => {
    expect(getActiveSandboxPolicy(sandboxOrg())).toBeNull();
    expect(getActiveSandboxPolicy(sandboxOrg({}))).toBe(
      SANDBOX_POLICIES["agent-signup"],
    );
    expect(getActiveSandboxPolicy(sandboxOrg({ status: "linked" }))).toBeNull();
    expect(
      getActiveSandboxPolicy(sandboxOrg({ status: "expired" })),
    ).toBeNull();
  });
});

describe("removePermissions", () => {
  it("strips the permission from the global role, project roles and env grants", () => {
    const permissions: UserPermissions = {
      global: {
        limitAccessByEnvironment: false,
        environments: [],
        permissions: { runExperiments: true, createFeatureDrafts: true },
        envGrants: [
          {
            limitAccessByEnvironment: false,
            environments: [],
            permissions: ["runExperiments", "createFeatureDrafts"],
          },
        ],
      },
      projects: {
        prj_a: {
          limitAccessByEnvironment: true,
          environments: ["dev"],
          permissions: { runExperiments: true, publishFeatures: true },
        },
      },
    };
    const masked = removePermissions(permissions, ["runExperiments"]);
    expect(masked.global.permissions).toEqual({ createFeatureDrafts: true });
    expect(masked.global.envGrants?.[0].permissions).toEqual([
      "createFeatureDrafts",
    ]);
    expect(masked.projects.prj_a.permissions).toEqual({
      publishFeatures: true,
    });
    // The input is left alone: the resolver hands out copies.
    expect(permissions.global.permissions.runExperiments).toBe(true);
  });
});

describe("getRolePermissions in a sandbox", () => {
  it("keeps flag work and takes away experiments, data sources and webhooks from an admin", () => {
    const permissions = getRolePermissions(admin, sandboxOrg({}), []);
    for (const denied of SANDBOX_POLICIES["agent-signup"].deniedPermissions) {
      expect(hasPermission(permissions, denied, "", ["production"])).toBe(
        false,
      );
    }
    expect(
      hasPermission(permissions, "createFeatures", "", ["production"]),
    ).toBe(true);
    expect(
      hasPermission(permissions, "publishFeatures", "", ["production"]),
    ).toBe(true);
    expect(hasPermission(permissions, "editFeatureDrafts", "")).toBe(true);
    expect(hasPermission(permissions, "createAnalyses", "")).toBe(true);
  });

  it("gives everything back once the sandbox is linked", () => {
    const permissions = getRolePermissions(
      admin,
      sandboxOrg({ status: "linked" }),
      [],
    );
    expect(
      hasPermission(permissions, "runExperiments", "", ["production"]),
    ).toBe(true);
    expect(hasPermission(permissions, "createDatasources", "")).toBe(true);
    expect(hasPermission(permissions, "manageIntegrations")).toBe(true);
  });

  it("leaves a workspace without a sandbox record alone", () => {
    const permissions = getRolePermissions(admin, sandboxOrg(), []);
    expect(
      hasPermission(permissions, "runExperiments", "", ["production"]),
    ).toBe(true);
  });
});
