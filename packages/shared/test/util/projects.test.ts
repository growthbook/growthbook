import {
  isProjectListValidForProject,
  isProjectListValidForProjects,
} from "../../src/util";

describe("isProjectListValidForProject", () => {
  it("should return true when item has no project restrictions", () => {
    expect(isProjectListValidForProject([], "project-a")).toBe(true);
    expect(isProjectListValidForProject(undefined, "project-a")).toBe(true);
  });

  it("should return true when no project is selected", () => {
    expect(isProjectListValidForProject(["project-a"], undefined)).toBe(true);
    expect(isProjectListValidForProject(["project-a"], "")).toBe(true);
  });

  it("should return true when item includes the selected project", () => {
    expect(isProjectListValidForProject(["project-a"], "project-a")).toBe(true);
    expect(
      isProjectListValidForProject(["project-a", "project-b"], "project-a"),
    ).toBe(true);
  });

  it("should return false when item does not include the selected project", () => {
    expect(isProjectListValidForProject(["project-a"], "project-b")).toBe(
      false,
    );
    expect(
      isProjectListValidForProject(["project-a", "project-c"], "project-b"),
    ).toBe(false);
  });
});

describe("isProjectListValidForProjects", () => {
  it("should return true when no required projects are specified", () => {
    expect(isProjectListValidForProjects(["project-a"], [])).toBe(true);
    expect(isProjectListValidForProjects(["project-a"], undefined)).toBe(true);
  });

  it("should return true when item has no project restrictions", () => {
    expect(isProjectListValidForProjects([], ["project-a"])).toBe(true);
    expect(isProjectListValidForProjects(undefined, ["project-a"])).toBe(true);
    expect(isProjectListValidForProjects([], ["project-a", "project-b"])).toBe(
      true,
    );
  });

  it("should return true when item is available in all required projects", () => {
    expect(isProjectListValidForProjects(["project-a"], ["project-a"])).toBe(
      true,
    );
    expect(
      isProjectListValidForProjects(
        ["project-a", "project-b"],
        ["project-a", "project-b"],
      ),
    ).toBe(true);
    expect(
      isProjectListValidForProjects(
        ["project-a", "project-b", "project-c"],
        ["project-a", "project-b"],
      ),
    ).toBe(true);
  });

  it("should return false when item is not available in all required projects", () => {
    expect(isProjectListValidForProjects(["project-a"], ["project-b"])).toBe(
      false,
    );
    expect(
      isProjectListValidForProjects(["project-a"], ["project-a", "project-b"]),
    ).toBe(false);
    expect(
      isProjectListValidForProjects(
        ["project-a", "project-c"],
        ["project-a", "project-b"],
      ),
    ).toBe(false);
  });
});
