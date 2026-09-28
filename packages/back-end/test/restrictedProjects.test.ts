import { OrganizationInterface } from "shared/types/organization";
import {
  Permissions,
  assessApprovalCoverage,
  getRolePermissions,
} from "shared/permissions";
import { getUserPermissions } from "back-end/src/util/organization.util";

const testOrg = {
  id: "org_restricted_projects",
  name: "Test Org",
  ownerEmail: "test@test.com",
  url: "https://test.com",
  dateCreated: new Date(),
  settings: {
    environments: [{ id: "development" }, { id: "production" }],
  },
  members: [],
  invites: [],
} as unknown as OrganizationInterface;

const RESTRICTED = "prj_private";
const OPEN = "prj_open";

const orgWith = (member: Record<string, unknown>) =>
  ({
    ...testOrg,
    members: [{ id: "u_1", ...member }],
  }) as unknown as OrganizationInterface;

const permsFor = (
  member: Record<string, unknown>,
  restrictedProjects: string[] = [RESTRICTED],
  teams: unknown[] = [],
) =>
  new Permissions(
    getUserPermissions(
      { id: "u_1" },
      orgWith(member),
      teams as never,
      restrictedProjects,
    ),
  );

describe("access-restricted projects", () => {
  it("denies a member whose only access is their global role", () => {
    const perms = permsFor({ role: "engineer" });
    expect(perms.canReadSingleProjectResource(RESTRICTED)).toBe(false);
    expect(perms.canViewFeatureModal(RESTRICTED)).toBe(false);
  });

  it("leaves other projects and org-level resources untouched", () => {
    const perms = permsFor({ role: "engineer" });
    expect(perms.canReadSingleProjectResource(OPEN)).toBe(true);
    expect(perms.canReadSingleProjectResource("")).toBe(true);
    expect(perms.canReadSingleProjectResource(undefined)).toBe(true);
  });

  it("changes nothing when no project is restricted", () => {
    const perms = permsFor({ role: "engineer" }, []);
    expect(perms.canReadSingleProjectResource(RESTRICTED)).toBe(true);
  });

  it("grants exactly the explicitly assigned project role", () => {
    const perms = permsFor({
      role: "engineer",
      projectRoles: [
        {
          project: RESTRICTED,
          role: "readonly",
          limitAccessByEnvironment: false,
          environments: [],
        },
      ],
    });
    expect(perms.canReadSingleProjectResource(RESTRICTED)).toBe(true);
    // The explicit role is readonly — the global engineer role must not leak in
    expect(perms.canViewFeatureModal(RESTRICTED)).toBe(false);
  });

  it("counts a team-assigned project role as an explicit grant", () => {
    const perms = permsFor(
      { role: "readonly", teams: ["team_1"] },
      [RESTRICTED],
      [
        {
          id: "team_1",
          role: "readonly",
          limitAccessByEnvironment: false,
          environments: [],
          projectRoles: [
            {
              project: RESTRICTED,
              role: "engineer",
              limitAccessByEnvironment: false,
              environments: [],
            },
          ],
        },
      ],
    );
    expect(perms.canReadSingleProjectResource(RESTRICTED)).toBe(true);
    expect(perms.canViewFeatureModal(RESTRICTED)).toBe(true);
  });

  it("exempts members whose global role can manage the team", () => {
    const perms = permsFor({ role: "admin" });
    expect(perms.canReadSingleProjectResource(RESTRICTED)).toBe(true);
    expect(perms.canViewFeatureModal(RESTRICTED)).toBe(true);
  });

  it("exempts super admins regardless of their member role", () => {
    const perms = new Permissions(
      getUserPermissions(
        { id: "u_1", superAdmin: true },
        orgWith({ role: "readonly" }),
        [],
        [RESTRICTED],
      ),
    );
    expect(perms.canReadSingleProjectResource(RESTRICTED)).toBe(true);
  });

  it("applies to role-based org API keys", () => {
    const perms = new Permissions(
      getRolePermissions(
        { role: "readonly", limitAccessByEnvironment: false, environments: [] },
        testOrg,
        [],
        [RESTRICTED],
      ),
    );
    expect(perms.canReadSingleProjectResource(RESTRICTED)).toBe(false);
    expect(perms.canReadSingleProjectResource(OPEN)).toBe(true);
  });

  it("excludes restricted projects from query-level read allowlists", () => {
    const allProjects = [RESTRICTED, OPEN];
    // Global role + a denial → an explicit allowlist, not "all projects"
    expect(
      permsFor({ role: "engineer" }).getProjectsWithPermission(
        "readData",
        allProjects,
      ),
    ).toEqual([OPEN]);
    // No restriction → unrestricted
    expect(
      permsFor({ role: "engineer" }, []).getProjectsWithPermission(
        "readData",
        allProjects,
      ),
    ).toBeNull();
    // Explicit grant on the restricted project → included again
    expect(
      permsFor({
        role: "engineer",
        projectRoles: [
          {
            project: RESTRICTED,
            role: "readonly",
            limitAccessByEnvironment: false,
            environments: [],
          },
        ],
      }).getProjectsWithPermission("readData", allProjects),
    ).toBeNull();
    // manageTeam exemption → unrestricted
    expect(
      permsFor({ role: "admin" }).getProjectsWithPermission(
        "readData",
        allProjects,
      ),
    ).toBeNull();
  });

  // Deliberately permissive: an approval from a member who later lost access
  // via a restricted project still covers — deferred/scheduled actions run on
  // the authority they were enabled with.
  it("still counts a restricted-out member's approval as covering", () => {
    expect(
      assessApprovalCoverage({
        org: testOrg,
        teams: [],
        model: "feature",
        projects: [RESTRICTED],
        footprint: { scope: "unbound" },
        approvers: [
          {
            id: "u_1",
            roleInfo: {
              role: "experimenter",
              limitAccessByEnvironment: false,
              environments: [] as string[],
            },
          },
        ],
      }).hasCoveringApproval,
    ).toBe(true);
  });

  it("keeps a restricted project out of multi-project read unions", () => {
    const perms = permsFor({ role: "engineer" });
    // Readable via the open project
    expect(perms.canReadMultiProjectResource([RESTRICTED, OPEN])).toBe(true);
    // Not readable when the restricted project is its only home
    expect(perms.canReadMultiProjectResource([RESTRICTED])).toBe(false);
  });
});
