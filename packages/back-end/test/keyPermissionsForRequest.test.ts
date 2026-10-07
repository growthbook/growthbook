import { OrganizationInterface } from "shared/types/organization";
import { ApiKeyWithRole } from "shared/types/apikey";
import { TeamInterface } from "shared/types/team";
import { Permissions, RequesterRules, hasPermission } from "shared/permissions";
import {
  getKeyPermissionsForRequest,
  getUserPermissions,
} from "back-end/src/util/organization.util";

const org = {
  id: "org_requester_rules",
  settings: { environments: [{ id: "development" }, { id: "production" }] },
  members: [
    { id: "u_admin", role: "admin" },
    { id: "u_reader", role: "readonly" },
    { id: "u_team_engineer", role: "readonly", teams: ["t_eng"] },
    { id: "u_engineer", role: "engineer" },
  ],
} as unknown as OrganizationInterface;

const teams = [
  {
    id: "t_eng",
    name: "Engineering",
    role: "engineer",
    limitAccessByEnvironment: false,
    environments: [],
  },
] as unknown as TeamInterface[];

const rule = (role: string, requesterOnly = false) => ({
  role,
  limitAccessByEnvironment: false,
  environments: [],
  ...(requesterOnly ? { requesterOnly } : {}),
});

const key = (rules: RequesterRules) => rules as unknown as ApiKeyWithRole;

const forRequest = (
  apiKey: ApiKeyWithRole,
  requesterId: string | null,
  restricted: string[] = [],
) => {
  const permissions = getKeyPermissionsForRequest({
    apiKey,
    requesterId,
    org,
    teams,
    restrictedProjects: restricted,
  });
  if (!permissions) throw new Error("expected requester-dependent permissions");
  return permissions;
};

const canEdit = (permissions: ReturnType<typeof forRequest>, project = "") =>
  hasPermission(permissions, "editFeatureDrafts", project);

// Read access always; engineer only as far as the requester has it.
const engineerIfRequesterHasIt = key({
  ...rule("readonly"),
  additionalRoles: [rule("engineer", true)],
});

describe("getKeyPermissionsForRequest", () => {
  it("leaves a key with no requester-only rules to its own role", () => {
    expect(
      getKeyPermissionsForRequest({
        apiKey: key(rule("engineer")),
        requesterId: "u_reader",
        org,
        teams,
        restrictedProjects: [],
      }),
    ).toBeUndefined();
  });

  it("gives a request that names no one only the rules that always apply", () => {
    const result = forRequest(engineerIfRequesterHasIt, null);
    expect(hasPermission(result, "readData")).toBe(true);
    expect(canEdit(result)).toBe(false);
  });

  it.each([
    ["a member whose team grants it", "u_team_engineer", true],
    ["a member without it", "u_reader", false],
  ])("extends to %s", (_, requesterId, expected) => {
    expect(canEdit(forRequest(engineerIfRequesterHasIt, requesterId))).toBe(
      expected,
    );
  });

  it("never goes past the requester-only rules, even for an admin", () => {
    // Canary: the member alone could edit, so `false` below isn't vacuous.
    expect(canEdit(getUserPermissions({ id: "u_admin" }, org, teams))).toBe(
      true,
    );
    const readonlyEitherWay = key({
      ...rule("readonly"),
      additionalRoles: [rule("readonly", true)],
    });
    expect(canEdit(forRequest(readonlyEitherWay, "u_admin"))).toBe(false);
  });

  it("keeps a project group replacing the All Projects rules on both sides", () => {
    // Engineer everywhere, but inside p1 only readonly, and only for the requester.
    const apiKey = key({
      ...rule("engineer"),
      projectRoles: [{ project: "p1", ...rule("readonly", true) }],
    });
    const named = forRequest(apiKey, "u_engineer");
    expect(canEdit(named, "p2")).toBe(true);
    expect(canEdit(named, "p1")).toBe(false);
    expect(hasPermission(named, "readData", "p1")).toBe(true);
    expect(hasPermission(forRequest(apiKey, null), "readData", "p1")).toBe(
      false,
    );
  });

  it("keeps requester-only rules out of the member's access-restricted projects", () => {
    const permissions = new Permissions(
      forRequest(key(rule("admin", true)), "u_engineer", ["prj_private"]),
    );
    expect(permissions.canReadSingleProjectResource("prj_open")).toBe(true);
    expect(permissions.canReadSingleProjectResource("prj_private")).toBe(false);
  });
});
