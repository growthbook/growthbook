import { OrganizationInterface } from "shared/types/organization";
import {
  API_KEY_ONLY_ROLE_IDS,
  DEFAULT_ROLES,
  RESERVED_ROLE_IDS,
  TRACE_INGEST_ROLE_ID,
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

describe("traceIngest role", () => {
  it("is a default role with no policies", () => {
    expect(DEFAULT_ROLES.traceIngest).toMatchObject({
      id: TRACE_INGEST_ROLE_ID,
      policies: [],
    });
    expect(API_KEY_ONLY_ROLE_IDS).toEqual([TRACE_INGEST_ROLE_ID]);
    expect(isApiKeyOnlyRole("traceIngest")).toBe(true);
    expect(isApiKeyOnlyRole("visualEditor")).toBe(false);
    expect(isApiKeyOnlyRole("readonly")).toBe(false);
  });

  it("is reserved, so custom roles can't take the id", () => {
    expect(RESERVED_ROLE_IDS).toContain("traceIngest");
  });

  it("wins over an older custom role with the same id", () => {
    const withCustom = {
      ...org,
      customRoles: [
        { id: "traceIngest", description: "", policies: [...POLICIES] },
      ],
    } as OrganizationInterface;
    expect(getRoles(withCustom).filter((r) => r.id === "traceIngest")).toEqual([
      DEFAULT_ROLES.traceIngest,
    ]);
  });

  it("can be looked up (for API keys) but isn't valid for members or teams", () => {
    expect(getRoleById("traceIngest", org)).toBe(DEFAULT_ROLES.traceIngest);
    expect(isRoleValid("traceIngest", org)).toBe(false);
    // Other default roles, including the visual editor one, are unaffected.
    expect(isRoleValid("visualEditor", org)).toBe(true);
    expect(isRoleValid("readonly", org)).toBe(true);
  });

  it("isn't valid as a project role or a project role's additional role", () => {
    expect(
      areProjectRolesValid([{ ...rule("traceIngest"), project: "prj_a" }], org),
    ).toBe(false);
    expect(
      areProjectRolesValid(
        [
          {
            ...rule("readonly"),
            project: "prj_a",
            additionalRoles: [rule("traceIngest")],
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
    expect(areAdditionalRolesValid([rule("traceIngest")], org)).toBe(false);
    expect(areAdditionalRolesValid([rule("engineer")], org)).toBe(true);
  });

  it("can't be the org default role", () => {
    const withDefault = {
      ...org,
      settings: { ...org.settings, defaultRole: rule("traceIngest") },
    } as OrganizationInterface;
    expect(getDefaultRole(withDefault).role).toBe("collaborator");
  });

  it("grants nothing and doesn't support environment limits", () => {
    expect(roleToPermissionMap("traceIngest", org)).toEqual({});
    expect(roleSupportsEnvLimit("traceIngest", org)).toBe(false);
  });

  it("resolves to empty permissions without errors", () => {
    const permissions = getRolePermissions(rule("traceIngest"), org, []);
    expect(permissions.global.permissions).toEqual({});
    expect(permissions.projects).toEqual({});

    const p = new Permissions(permissions);
    expect(p.canReadSingleProjectResource("")).toBe(false);
    expect(p.canCreateApiKey()).toBe(false);
    expect(p.canCreateMetric({ projects: [] })).toBe(false);
  });
});
