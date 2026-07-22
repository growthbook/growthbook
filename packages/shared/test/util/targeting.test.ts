import {
  getTargetingProjectIds,
  entityTargetsProject,
  resolveTargetingProjectIds,
  normalizeTargetingProjects,
  normalizeTargetingInUpdates,
  getTargetingReviewMode,
  getGoverningReviewProjects,
} from "shared/util";

describe("targeting scope helpers", () => {
  describe("getTargetingProjectIds", () => {
    it("returns the primary project deduped with targeting projects", () => {
      expect(
        getTargetingProjectIds({
          project: "p1",
          targetingProjects: ["p2", "p3", "p1"],
        }),
      ).toEqual(["p1", "p2", "p3"]);
    });

    it('returns [""] for a project-less entity', () => {
      expect(getTargetingProjectIds({})).toEqual([""]);
    });

    it("returns null (all projects) when targetingAllProjects is set", () => {
      expect(
        getTargetingProjectIds({
          project: "p1",
          targetingAllProjects: true,
          targetingProjects: ["p2"],
        }),
      ).toBeNull();
    });
  });

  describe("entityTargetsProject", () => {
    const entity = { project: "p1", targetingProjects: ["p2"] };
    it("matches the primary project", () => {
      expect(entityTargetsProject(entity, "p1")).toBe(true);
    });
    it("matches a targeting project", () => {
      expect(entityTargetsProject(entity, "p2")).toBe(true);
    });
    it("does not match an unrelated project", () => {
      expect(entityTargetsProject(entity, "p3")).toBe(false);
    });
    it("matches any project when targetingAllProjects is set", () => {
      expect(
        entityTargetsProject(
          { project: "p1", targetingAllProjects: true },
          "px",
        ),
      ).toBe(true);
    });
  });

  describe("resolveTargetingProjectIds", () => {
    const allProjectIds = ["p1", "p2", "p3", "p4"];

    it("returns the primary plus targeting projects, deduped", () => {
      expect(
        resolveTargetingProjectIds(
          { project: "p1", targetingProjects: ["p2", "p1"] },
          allProjectIds,
        ),
      ).toEqual(["p1", "p2"]);
    });

    it("enumerates all org projects when targetingAllProjects is set", () => {
      expect(
        resolveTargetingProjectIds(
          { project: "p1", targetingAllProjects: true },
          allProjectIds,
        ),
      ).toEqual(allProjectIds);
    });

    it("drops the empty primary for a project-less entity", () => {
      expect(
        resolveTargetingProjectIds(
          { targetingProjects: ["p2"] },
          allProjectIds,
        ),
      ).toEqual(["p2"]);
    });

    it("returns an empty array for an unscoped entity", () => {
      expect(resolveTargetingProjectIds({}, allProjectIds)).toEqual([]);
    });
  });

  describe("normalizeTargetingProjects", () => {
    it("drops the primary, blanks, and dupes from the list", () => {
      expect(
        normalizeTargetingProjects({
          project: "p1",
          targetingProjects: ["p1", "", "p2", "p2", "p3"],
        }),
      ).toEqual({
        targetingAllProjects: false,
        targetingProjects: ["p2", "p3"],
      });
    });

    it("clears the list when visible in all projects", () => {
      expect(
        normalizeTargetingProjects({
          project: "p1",
          targetingAllProjects: true,
          targetingProjects: ["p2"],
        }),
      ).toEqual({ targetingAllProjects: true, targetingProjects: [] });
    });
  });

  describe("getTargetingReviewMode", () => {
    it("defaults to strict with no rules", () => {
      expect(getTargetingReviewMode(undefined, "p2")).toBe("strict");
      expect(getTargetingReviewMode([], "p2")).toBe("strict");
    });
    it("uses the all-projects rule when no specific rule matches", () => {
      expect(
        getTargetingReviewMode([{ projects: [], mode: "loose" }], "p2"),
      ).toBe("loose");
    });
    it("prefers a project-specific rule over the all-projects rule", () => {
      expect(
        getTargetingReviewMode(
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
        getTargetingReviewMode([{ projects: ["p2"], mode: "loose" }], "p3"),
      ).toBe("strict");
    });
  });

  describe("getGoverningReviewProjects", () => {
    it("includes the primary plus all strict targeting projects by default", () => {
      expect(getGoverningReviewProjects("p1", ["p2", "p3"], undefined)).toEqual(
        ["p1", "p2", "p3"],
      );
    });
    it("excludes targeting projects marked loose", () => {
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

  describe("normalizeTargetingInUpdates", () => {
    it("strips the current primary from an update's targeting list", () => {
      const updates: {
        targetingProjects?: string[];
        project?: string;
      } = { targetingProjects: ["p1", "p2"] };
      normalizeTargetingInUpdates(updates, { project: "p1" });
      expect(updates.targetingProjects).toEqual(["p2"]);
    });
    it("uses the update's new project when the project is changing", () => {
      const updates: {
        targetingProjects?: string[];
        project?: string;
      } = { project: "p2", targetingProjects: ["p1", "p2"] };
      normalizeTargetingInUpdates(updates, { project: "p1" });
      expect(updates.targetingProjects).toEqual(["p1"]);
    });
    it("is a no-op when no targeting fields are present", () => {
      const updates: { project?: string; targetingProjects?: string[] } = {
        project: "p2",
      };
      normalizeTargetingInUpdates(updates, { project: "p1" });
      expect(updates).toEqual({ project: "p2" });
    });
    it("clears the list when the update sets targetingAllProjects", () => {
      const updates: {
        targetingAllProjects?: boolean;
        targetingProjects?: string[];
      } = { targetingAllProjects: true, targetingProjects: ["p2"] };
      normalizeTargetingInUpdates(updates, { project: "p1" });
      expect(updates).toEqual({
        targetingAllProjects: true,
        targetingProjects: [],
      });
    });
  });
});
