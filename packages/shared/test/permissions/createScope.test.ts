import { canCreateInSelectedScope } from "shared/permissions";

/**
 * The "All Projects" branch is the one that was wrong. Asking only the org-wide
 * question hid the Add control from anyone whose authority is project-scoped, and
 * a single read-only project was enough to hide it when it was the only project.
 */
describe("canCreateInSelectedScope", () => {
  const projectIds = ["prj_a", "prj_b"];

  it("asks about the selected project, and nothing else", () => {
    const asked: (string | undefined)[] = [];
    const result = canCreateInSelectedScope({
      project: "prj_b",
      projectIds,
      canCreateIn: (p) => {
        asked.push(p);
        return p === "prj_b";
      },
    });
    expect({ result, asked }).toEqual({ result: true, asked: ["prj_b"] });
  });

  it("refuses when the selected project isn't creatable", () => {
    expect(
      canCreateInSelectedScope({
        project: "prj_a",
        projectIds,
        canCreateIn: (p) => p === "prj_b",
      }),
    ).toBe(false);
  });

  it("permits org-wide authority under All Projects", () => {
    expect(
      canCreateInSelectedScope({
        project: "",
        projectIds,
        canCreateIn: (p) => p === undefined,
      }),
    ).toBe(true);
  });

  it("permits authority in a single project under All Projects", () => {
    expect(
      canCreateInSelectedScope({
        project: undefined,
        projectIds,
        canCreateIn: (p) => p === "prj_b",
      }),
    ).toBe(true);
  });

  it("refuses under All Projects when no project is creatable", () => {
    expect(
      canCreateInSelectedScope({
        project: "",
        projectIds,
        canCreateIn: () => false,
      }),
    ).toBe(false);
  });

  it("refuses under All Projects when the org has no projects at all", () => {
    expect(
      canCreateInSelectedScope({
        project: "",
        projectIds: [],
        canCreateIn: (p) => p !== undefined,
      }),
    ).toBe(false);
  });
});
