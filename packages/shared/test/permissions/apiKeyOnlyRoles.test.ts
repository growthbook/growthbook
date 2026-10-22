import { OrganizationInterface } from "shared/types/organization";
import {
  API_KEY_ONLY_ROLE_IDS,
  DEFAULT_ROLES,
  RESERVED_ROLE_IDS,
  TRACE_INGEST_ROLE_ID,
  apiKeyOnlyRoleProblem,
  apiKeyPrefixRole,
  areAdditionalRolesValid,
  areProjectRolesValid,
  getDefaultRole,
  getRoleById,
  getRolePermissions,
  getRoles,
  isApiKeyOnlyRole,
  isRoleValid,
  Permissions,
  POLICIES,
  roleSupportsEnvLimit,
  roleToPermissionMap,
} from "../../src/permissions";

const org = {
  id: "org_1",
  members: [],
  settings: { environments: [{ id: "production", description: "" }] },
} as unknown as OrganizationInterface;

const rule = (role: string) => ({
  role,
  limitAccessByEnvironment: false,
  environments: [],
});

describe("trace ingest role", () => {
  it("is a default role with no policies", () => {
    expect(DEFAULT_ROLES.gbDefault_traceIngest).toMatchObject({
      id: TRACE_INGEST_ROLE_ID,
      policies: [],
    });
    expect(API_KEY_ONLY_ROLE_IDS).toEqual([TRACE_INGEST_ROLE_ID]);
    expect(isApiKeyOnlyRole("gbDefault_traceIngest")).toBe(true);
    expect(isApiKeyOnlyRole("visualEditor")).toBe(false);
    expect(isApiKeyOnlyRole("readonly")).toBe(false);
  });

  it("is reserved, so custom roles can't take the id", () => {
    expect(RESERVED_ROLE_IDS).toContain("gbDefault_traceIngest");
    // Custom role ids can never start with gbDefault_, so no existing custom
    // role can share it.
    expect(TRACE_INGEST_ROLE_ID.startsWith("gbDefault_")).toBe(true);
  });

  it("wins over an older custom role with the same id", () => {
    const withCustom = {
      ...org,
      customRoles: [
        {
          id: "gbDefault_traceIngest",
          description: "",
          policies: [...POLICIES],
        },
      ],
    } as OrganizationInterface;
    expect(
      getRoles(withCustom).filter((r) => r.id === "gbDefault_traceIngest"),
    ).toEqual([DEFAULT_ROLES.gbDefault_traceIngest]);
  });

  it("can be looked up (for API keys) but isn't valid for members or teams", () => {
    expect(getRoleById("gbDefault_traceIngest", org)).toBe(
      DEFAULT_ROLES.gbDefault_traceIngest,
    );
    expect(isRoleValid("gbDefault_traceIngest", org)).toBe(false);
    // Other default roles, including the visual editor one, are unaffected.
    expect(isRoleValid("visualEditor", org)).toBe(true);
    expect(isRoleValid("readonly", org)).toBe(true);
  });

  it("isn't valid as a project role or a project role's additional role", () => {
    expect(
      areProjectRolesValid(
        [{ ...rule("gbDefault_traceIngest"), project: "prj_a" }],
        org,
      ),
    ).toBe(false);
    expect(
      areProjectRolesValid(
        [
          {
            ...rule("readonly"),
            project: "prj_a",
            additionalRoles: [rule("gbDefault_traceIngest")],
          },
        ],
        org,
      ),
    ).toBe(false);
    expect(
      areProjectRolesValid(
        [
          {
            ...rule("readonly"),
            project: "prj_a",
            additionalRoles: [rule("engineer")],
          },
        ],
        org,
      ),
    ).toBe(true);
    expect(
      areProjectRolesValid(
        [
          {
            ...rule("readonly"),
            project: "prj_a",
            additionalRoles: [rule("deletedCustomRole")],
          },
        ],
        org,
      ),
    ).toBe(false);
  });

  it("isn't valid as an additional role", () => {
    expect(areAdditionalRolesValid([rule("gbDefault_traceIngest")], org)).toBe(
      false,
    );
    expect(areAdditionalRolesValid([rule("engineer")], org)).toBe(true);
  });

  it("can't be the org default role", () => {
    const withDefault = {
      ...org,
      settings: { ...org.settings, defaultRole: rule("gbDefault_traceIngest") },
    } as OrganizationInterface;
    expect(getDefaultRole(withDefault).role).toBe("collaborator");
  });

  it("grants nothing and doesn't support environment limits", () => {
    expect(roleToPermissionMap("gbDefault_traceIngest", org)).toEqual({});
    expect(roleSupportsEnvLimit("gbDefault_traceIngest", org)).toBe(false);
  });

  it("resolves to empty permissions without errors", () => {
    const permissions = getRolePermissions(
      rule("gbDefault_traceIngest"),
      org,
      [],
    );
    expect(permissions.global.permissions).toEqual({});
    expect(permissions.projects).toEqual({});

    const p = new Permissions(permissions);
    expect(p.canReadSingleProjectResource("")).toBe(false);
    expect(p.canCreateApiKey()).toBe(false);
    expect(p.canCreateMetric({ projects: [] })).toBe(false);
  });
});

describe("apiKeyOnlyRoleProblem", () => {
  const ingest = { role: TRACE_INGEST_ROLE_ID };

  it("accepts a plain org key with the role, and ignores other roles", () => {
    expect(apiKeyOnlyRoleProblem(ingest)).toBeNull();
    expect(apiKeyOnlyRoleProblem(ingest, ingest)).toBeNull();
    expect(
      apiKeyOnlyRoleProblem({ role: "readonly", userId: "u_1" }),
    ).toBeNull();
  });

  it.each([
    { name: "an environment limit", scope: { limitAccessByEnvironment: true } },
    { name: "environments", scope: { environments: ["production"] } },
    {
      name: "additional roles",
      scope: { additionalRoles: [rule("readonly")] },
    },
    {
      name: "project roles",
      scope: { projectRoles: [{ ...rule("readonly"), project: "prj_a" }] },
    },
  ])("rejects the role with $name", ({ scope }) => {
    expect(apiKeyOnlyRoleProblem({ ...ingest, ...scope })).toBe(
      "The AI Trace Ingest role can't have environment limits, additional roles, or project roles.",
    );
  });

  it("rejects the role on a personal access token", () => {
    expect(apiKeyOnlyRoleProblem({ ...ingest, userId: "u_1" })).toBe(
      "The AI Trace Ingest role can only be used for organization API keys.",
    );
  });

  it("won't change a key's role to or from it", () => {
    const problem =
      "This key's role can't be changed to or from that role. Create a new key instead.";
    expect(apiKeyOnlyRoleProblem({ role: "admin" }, ingest)).toBe(problem);
    expect(apiKeyOnlyRoleProblem(ingest, { role: "admin" })).toBe(problem);
  });
});

describe("apiKeyPrefixRole", () => {
  it("drops gbDefault_ from API-key-only roles only", () => {
    expect(apiKeyPrefixRole(TRACE_INGEST_ROLE_ID)).toBe("traceIngest");
    expect(apiKeyPrefixRole("gbDefault_projectAdmin")).toBe(
      "gbDefault_projectAdm",
    );
    expect(apiKeyPrefixRole("readonly")).toBe("readonly");
  });
});
