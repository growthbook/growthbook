import {
  MemberRoleWithProjects,
  OrganizationInterface,
} from "shared/types/organization";
import {
  getRolePermissions,
  hasPermission,
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
