import { OrganizationInterface } from "shared/types/organization";
import { ApiKeyWithRole } from "shared/types/apikey";
import { TeamInterface } from "shared/types/team";
import { Permissions, hasPermission } from "shared/permissions";
import {
  getRequesterCappedPermissions,
  getUserPermissions,
} from "back-end/src/util/organization.util";

const org = {
  id: "org_capped",
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

const key = (role: string) =>
  ({
    role,
    limitAccessByEnvironment: false,
    environments: [],
  }) as unknown as ApiKeyWithRole;

const capped = (
  keyRole: string,
  requesterId: string,
  restricted: string[] = [],
) =>
  getRequesterCappedPermissions(
    key(keyRole),
    requesterId,
    org,
    teams,
    restricted,
  );

describe("getRequesterCappedPermissions", () => {
  it("never gives more than the key, even for an admin requester", () => {
    // Canary: the requester alone could edit, so `false` below isn't vacuous.
    expect(
      hasPermission(
        getUserPermissions({ id: "u_admin" }, org, teams),
        "editFeatureDrafts",
      ),
    ).toBe(true);
    expect(
      hasPermission(capped("readonly", "u_admin"), "editFeatureDrafts"),
    ).toBe(false);
  });

  it("applies the requester's own permissions, including team roles", () => {
    expect(
      hasPermission(capped("admin", "u_team_engineer"), "editFeatureDrafts"),
    ).toBe(true);
    expect(
      hasPermission(capped("admin", "u_reader"), "editFeatureDrafts"),
    ).toBe(false);
  });

  it("keeps the requester out of access-restricted projects", () => {
    const permissions = new Permissions(
      capped("admin", "u_engineer", ["prj_private"]),
    );
    expect(permissions.canReadSingleProjectResource("prj_open")).toBe(true);
    expect(permissions.canReadSingleProjectResource("prj_private")).toBe(false);
  });
});
