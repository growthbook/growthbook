import {
  hasNoDuplicateProjects,
  memberRoleWithProjects,
} from "shared/validators";
import { areProjectRolesValid } from "shared/permissions";

const rule = (project: string, role = "engineer") => ({
  project,
  role,
  limitAccessByEnvironment: false,
  environments: [],
});

const parse = (projectRoles: unknown) =>
  memberRoleWithProjects.safeParse({
    role: "collaborator",
    limitAccessByEnvironment: false,
    environments: [],
    projectRoles,
  });

describe("one rule per project", () => {
  it("accepts distinct projects", () => {
    expect(parse([rule("prj_1"), rule("prj_2")]).success).toBe(true);
  });

  // The reason this is rejected rather than merged: two entries UNION, so the
  // second reads as an override and is not.
  it("rejects a second rule for the same project", () => {
    const result = parse([rule("prj_1"), rule("prj_1", "admin")]);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/one rule per project/i);
  });

  it("accepts a second role in a project via additionalRoles", () => {
    expect(
      parse([
        {
          ...rule("prj_1"),
          additionalRoles: [
            {
              role: "analyst",
              limitAccessByEnvironment: false,
              environments: [],
            },
          ],
        },
      ]).success,
    ).toBe(true);
  });

  it("treats absent and empty as fine", () => {
    expect(parse(undefined).success).toBe(true);
    expect(parse([]).success).toBe(true);
    expect(hasNoDuplicateProjects(undefined)).toBe(true);
  });
});

// The internal member/invite/default-role writes are AuthRequests with no zod
// validation, so the schema refine above never runs on them. areProjectRolesValid
// is the guard all three share.
describe("the internal write path rejects duplicates too", () => {
  const org = {
    customRoles: [
      { id: "engineer2", description: "", policies: ["FlagsReview" as const] },
    ],
  };

  it("accepts distinct projects", () => {
    expect(
      areProjectRolesValid(
        [rule("prj_1", "engineer2"), rule("prj_2", "engineer2")],
        org,
      ),
    ).toBe(true);
  });

  it("rejects a second rule for the same project", () => {
    expect(
      areProjectRolesValid(
        [rule("prj_1", "engineer2"), rule("prj_1", "engineer2")],
        org,
      ),
    ).toBe(false);
  });

  it("still rejects an unknown role", () => {
    expect(areProjectRolesValid([rule("prj_1", "nope")], org)).toBe(false);
  });

  it("treats absent as valid", () => {
    expect(areProjectRolesValid(undefined, org)).toBe(true);
  });
});
