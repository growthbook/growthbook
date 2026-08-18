import {
  hasNoDuplicateProjects,
  memberRoleWithProjects,
} from "shared/validators";

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
