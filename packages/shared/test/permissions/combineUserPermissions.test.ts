import {
  MemberRoleWithProjects,
  OrganizationInterface,
} from "shared/types/organization";
import {
  getRolePermissions,
  hasPermission,
  intersectUserPermissions,
  Permissions,
  unionUserPermissions,
} from "../../src/permissions";

const org = {
  id: "org_1",
  settings: {
    environments: [
      { id: "dev", description: "" },
      { id: "staging", description: "" },
      { id: "production", description: "" },
    ],
  },
} as unknown as OrganizationInterface;

const role = (
  role: string,
  extra: Partial<MemberRoleWithProjects> = {},
): MemberRoleWithProjects => ({
  role,
  limitAccessByEnvironment: false,
  environments: [],
  ...extra,
});

const intersect = (
  key: MemberRoleWithProjects,
  requester: MemberRoleWithProjects,
  restrictedProjects?: string[],
) =>
  intersectUserPermissions(
    getRolePermissions(key, org, [], restrictedProjects),
    getRolePermissions(requester, org, [], restrictedProjects),
  );

describe("intersectUserPermissions", () => {
  it("keeps a permission only when both sides grant it", () => {
    // Canary: the engineer side really grants it, so `false` below isn't vacuous.
    expect(
      hasPermission(
        getRolePermissions(role("engineer"), org, []),
        "editFeatureDrafts",
      ),
    ).toBe(true);
    const result = intersect(role("engineer"), role("readonly"));
    expect(hasPermission(result, "readData")).toBe(true);
    expect(hasPermission(result, "editFeatureDrafts")).toBe(false);
  });

  it.each([
    [
      "the requester's",
      role("admin"),
      role("readonly", {
        projectRoles: [{ ...role("engineer"), project: "p1" }],
      }),
    ],
    [
      "the key's",
      role("readonly", {
        projectRoles: [{ ...role("engineer"), project: "p1" }],
      }),
      role("engineer"),
    ],
  ])("applies %s project roles", (_, key, requester) => {
    const result = intersect(key, requester);
    expect(hasPermission(result, "editFeatureDrafts", "p1")).toBe(true);
    expect(hasPermission(result, "editFeatureDrafts", "p2")).toBe(false);
    expect(hasPermission(result, "editFeatureDrafts")).toBe(false);
  });

  it("keeps only the environments both sides allow", () => {
    const result = intersect(
      role("engineer", {
        limitAccessByEnvironment: true,
        environments: ["dev", "staging"],
      }),
      role("engineer", {
        limitAccessByEnvironment: true,
        environments: ["staging", "production"],
      }),
    );
    expect(hasPermission(result, "publishFeatures", "", ["staging"])).toBe(
      true,
    );
    expect(hasPermission(result, "publishFeatures", "", ["dev"])).toBe(false);
    expect(hasPermission(result, "publishFeatures", "", ["production"])).toBe(
      false,
    );
  });

  it("takes the other side's environments when one side is unrestricted", () => {
    const result = intersect(
      role("engineer"),
      role("engineer", {
        limitAccessByEnvironment: true,
        environments: ["production"],
      }),
    );
    expect(hasPermission(result, "publishFeatures", "", ["production"])).toBe(
      true,
    );
    expect(hasPermission(result, "publishFeatures", "", ["dev"])).toBe(false);
  });

  it("keeps an access-restricted project closed when only one side can enter", () => {
    // Admins hold manageTeam, which exempts them from the restriction.
    const result = intersect(role("admin"), role("engineer"), ["secret"]);
    const permissions = new Permissions(result);
    expect(permissions.canReadSingleProjectResource("secret")).toBe(false);
    expect(permissions.canReadSingleProjectResource("open")).toBe(true);
  });
});

describe("unionUserPermissions", () => {
  const union = (a: MemberRoleWithProjects, b: MemberRoleWithProjects) =>
    unionUserPermissions(
      getRolePermissions(a, org, []),
      getRolePermissions(b, org, []),
      org,
    );

  it("grants what either side grants, judging each project on its own side", () => {
    const result = union(
      role("analyst"),
      role("noaccess", {
        projectRoles: [{ ...role("engineer"), project: "p1" }],
      }),
    );
    // The analyst's global role still reaches p1, where only the other side
    // has a project role.
    expect(hasPermission(result, "createMetrics", "p1")).toBe(true);
    expect(hasPermission(result, "createFeatures", "p1")).toBe(true);
    expect(hasPermission(result, "createFeatures", "p2")).toBe(false);
    expect(hasPermission(result, "createFeatures")).toBe(false);
  });

  it("covers the environments either side allows", () => {
    const result = union(
      role("engineer", {
        limitAccessByEnvironment: true,
        environments: ["dev"],
      }),
      role("engineer", {
        limitAccessByEnvironment: true,
        environments: ["production"],
      }),
    );
    expect(hasPermission(result, "publishFeatures", "", ["dev"])).toBe(true);
    expect(hasPermission(result, "publishFeatures", "", ["production"])).toBe(
      true,
    );
    expect(hasPermission(result, "publishFeatures", "", ["staging"])).toBe(
      false,
    );
  });

  it("leaves both inputs untouched", () => {
    const a = getRolePermissions(role("readonly"), org, []);
    const b = getRolePermissions(role("engineer"), org, []);
    const before = JSON.stringify([a, b]);
    unionUserPermissions(a, b, org);
    expect(JSON.stringify([a, b])).toBe(before);
  });
});
