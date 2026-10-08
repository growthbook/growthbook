import { OrganizationInterface } from "shared/types/organization";
import { ApiKeyWithRole } from "shared/types/apikey";
import { TeamInterface } from "shared/types/team";
import { Permissions, hasPermission } from "shared/permissions";
import {
  getKeyPermissionsForRequest,
  getUserPermissions,
} from "back-end/src/util/organization.util";

const org = {
  id: "org_key_for_member",
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

const rule = (role: string) => ({
  role,
  limitAccessByEnvironment: false,
  environments: [],
});

const key = (rules: object) => rules as unknown as ApiKeyWithRole;

const forRequest = (
  apiKey: ApiKeyWithRole,
  requesterId: string,
  restricted: string[] = [],
) => {
  const permissions = getKeyPermissionsForRequest({
    apiKey,
    requesterId,
    org,
    teams,
    restrictedProjects: restricted,
  });
  if (!permissions) throw new Error("expected the member to narrow the key");
  return permissions;
};

const canEdit = (permissions: ReturnType<typeof forRequest>, project = "") =>
  hasPermission(permissions, "editFeatureDrafts", project);

describe("getKeyPermissionsForRequest", () => {
  it("keeps the key's own role when the request names no one", () => {
    expect(
      getKeyPermissionsForRequest({
        apiKey: key(rule("engineer")),
        requesterId: null,
        org,
        teams,
        restrictedProjects: [],
      }),
    ).toBeUndefined();
  });

  it.each([
    ["a member whose team grants it", "u_team_engineer", true],
    ["a member with it", "u_engineer", true],
    ["a member without it", "u_reader", false],
  ])("lets an engineer key edit for %s", (_, requesterId, expected) => {
    expect(canEdit(forRequest(key(rule("engineer")), requesterId))).toBe(
      expected,
    );
  });

  it("never goes past the key's own role, even for an admin", () => {
    // Canary: the member alone could edit, so `false` below isn't vacuous.
    expect(canEdit(getUserPermissions({ id: "u_admin" }, org, teams))).toBe(
      true,
    );
    const named = forRequest(key(rule("readonly")), "u_admin");
    expect(canEdit(named)).toBe(false);
    expect(hasPermission(named, "readData")).toBe(true);
  });

  it("narrows per project on the key's side too", () => {
    const apiKey = key({
      ...rule("engineer"),
      projectRoles: [{ project: "p1", ...rule("readonly") }],
    });
    const named = forRequest(apiKey, "u_engineer");
    expect(canEdit(named, "p2")).toBe(true);
    expect(canEdit(named, "p1")).toBe(false);
    expect(hasPermission(named, "readData", "p1")).toBe(true);
  });

  it("keeps the member's access-restricted projects closed", () => {
    const permissions = new Permissions(
      forRequest(key(rule("admin")), "u_engineer", ["prj_private"]),
    );
    expect(permissions.canReadSingleProjectResource("prj_open")).toBe(true);
    expect(permissions.canReadSingleProjectResource("prj_private")).toBe(false);
  });
});
