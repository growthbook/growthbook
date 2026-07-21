import {
  getVisibilityProjectIds,
  entityVisibleInProject,
  normalizeVisibilityProjects,
  normalizeVisibilityInUpdates,
  getVisibilityReviewMode,
  getGoverningReviewProjects,
} from "shared/util";

describe("visibility scope helpers", () => {
  describe("getVisibilityProjectIds", () => {
    it("returns the primary project deduped with visibility projects", () => {
      expect(
        getVisibilityProjectIds({
          project: "p1",
          visibilityProjects: ["p2", "p3", "p1"],
        }),
      ).toEqual(["p1", "p2", "p3"]);
    });

    it('returns [""] for a project-less entity', () => {
      expect(getVisibilityProjectIds({})).toEqual([""]);
    });

    it("returns null (all projects) when visibilityAllProjects is set", () => {
      expect(
        getVisibilityProjectIds({
          project: "p1",
          visibilityAllProjects: true,
          visibilityProjects: ["p2"],
        }),
      ).toBeNull();
    });
  });

  describe("entityVisibleInProject", () => {
    const entity = { project: "p1", visibilityProjects: ["p2"] };
    it("matches the primary project", () => {
      expect(entityVisibleInProject(entity, "p1")).toBe(true);
    });
    it("matches a visibility project", () => {
      expect(entityVisibleInProject(entity, "p2")).toBe(true);
    });
    it("does not match an unrelated project", () => {
      expect(entityVisibleInProject(entity, "p3")).toBe(false);
    });
    it("matches any project when visibilityAllProjects is set", () => {
      expect(
        entityVisibleInProject(
          { project: "p1", visibilityAllProjects: true },
          "px",
        ),
      ).toBe(true);
    });
  });

  describe("normalizeVisibilityProjects", () => {
    it("drops the primary, blanks, and dupes from the list", () => {
      expect(
        normalizeVisibilityProjects({
          project: "p1",
          visibilityProjects: ["p1", "", "p2", "p2", "p3"],
        }),
      ).toEqual({
        visibilityAllProjects: false,
        visibilityProjects: ["p2", "p3"],
      });
    });

    it("clears the list when visible in all projects", () => {
      expect(
        normalizeVisibilityProjects({
          project: "p1",
          visibilityAllProjects: true,
          visibilityProjects: ["p2"],
        }),
      ).toEqual({ visibilityAllProjects: true, visibilityProjects: [] });
    });
  });

  describe("getVisibilityReviewMode", () => {
    it("defaults to strict with no rules", () => {
      expect(getVisibilityReviewMode(undefined, "p2")).toBe("strict");
      expect(getVisibilityReviewMode([], "p2")).toBe("strict");
    });
    it("uses the all-projects rule when no specific rule matches", () => {
      expect(
        getVisibilityReviewMode([{ projects: [], mode: "loose" }], "p2"),
      ).toBe("loose");
    });
    it("prefers a project-specific rule over the all-projects rule", () => {
      expect(
        getVisibilityReviewMode(
          [
            { projects: [], mode: "loose" },
            { projects: ["p2"], mode: "strict" },
          ],
          "p2",
        ),
      ).toBe("strict");
    });
    it("defaults to strict when a specific rule matches a different project", () => {
      expect(
        getVisibilityReviewMode([{ projects: ["p2"], mode: "loose" }], "p3"),
      ).toBe("strict");
    });
  });

  describe("getGoverningReviewProjects", () => {
    it("includes the primary plus all strict visibility projects by default", () => {
      expect(getGoverningReviewProjects("p1", ["p2", "p3"], undefined)).toEqual(
        ["p1", "p2", "p3"],
      );
    });
    it("excludes visibility projects marked loose", () => {
      expect(
        getGoverningReviewProjects(
          "p1",
          ["p2", "p3"],
          [{ projects: ["p2"], mode: "loose" }],
        ),
      ).toEqual(["p1", "p3"]);
    });
    it("keeps only the primary when the org-wide rule is loose", () => {
      expect(
        getGoverningReviewProjects(
          "p1",
          ["p2", "p3"],
          [{ projects: [], mode: "loose" }],
        ),
      ).toEqual(["p1"]);
    });
  });

  describe("normalizeVisibilityInUpdates", () => {
    it("strips the current primary from an update's visibility list", () => {
      const updates: {
        visibilityProjects?: string[];
        project?: string;
      } = { visibilityProjects: ["p1", "p2"] };
      normalizeVisibilityInUpdates(updates, { project: "p1" });
      expect(updates.visibilityProjects).toEqual(["p2"]);
    });
    it("uses the update's new project when the project is changing", () => {
      const updates: {
        visibilityProjects?: string[];
        project?: string;
      } = { project: "p2", visibilityProjects: ["p1", "p2"] };
      normalizeVisibilityInUpdates(updates, { project: "p1" });
      expect(updates.visibilityProjects).toEqual(["p1"]);
    });
    it("is a no-op when no visibility fields are present", () => {
      const updates: { project?: string; visibilityProjects?: string[] } = {
        project: "p2",
      };
      normalizeVisibilityInUpdates(updates, { project: "p1" });
      expect(updates).toEqual({ project: "p2" });
    });
    it("clears the list when the update sets visibilityAllProjects", () => {
      const updates: {
        visibilityAllProjects?: boolean;
        visibilityProjects?: string[];
      } = { visibilityAllProjects: true, visibilityProjects: ["p2"] };
      normalizeVisibilityInUpdates(updates, { project: "p1" });
      expect(updates).toEqual({
        visibilityAllProjects: true,
        visibilityProjects: [],
      });
    });
  });
});
