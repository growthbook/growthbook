import {
  addedTargetingProjects,
  assertTargetingDestination,
  holdsTargetingDestination,
  withStagedTargeting,
} from "shared/permissions";

describe("addedTargetingProjects", () => {
  const live = { project: "prj_b", targetingProjects: ["prj_a"] };

  it("is empty when nothing changes or delivery narrows", () => {
    expect(addedTargetingProjects(live, live)).toEqual([]);
    expect(
      addedTargetingProjects(live, { ...live, targetingProjects: [] }),
    ).toEqual([]);
    expect(
      addedTargetingProjects(
        { ...live, targetingAllProjects: true },
        { ...live, targetingAllProjects: false },
      ),
    ).toEqual([]);
  });

  it("names only the projects newly reached", () => {
    expect(
      addedTargetingProjects(live, {
        ...live,
        targetingProjects: ["prj_a", "prj_c", "prj_c"],
      }),
    ).toEqual(["prj_c"]);
  });

  // The primary already receives the flag, and a primary move is gated by move
  // authority; neither is a targeting addition.
  it("ignores the primary project and blanks", () => {
    expect(
      addedTargetingProjects(live, {
        ...live,
        targetingProjects: ["prj_b", "", "prj_a"],
      }),
    ).toEqual([]);
    expect(
      addedTargetingProjects(live, {
        project: "prj_c",
        targetingProjects: ["prj_c", "prj_a"],
      }),
    ).toEqual([]);
  });

  it("is 'all' only when all-projects turns on", () => {
    expect(
      addedTargetingProjects(live, { ...live, targetingAllProjects: true }),
    ).toBe("all");
    expect(
      addedTargetingProjects(
        { ...live, targetingAllProjects: true },
        { ...live, targetingAllProjects: true },
      ),
    ).toEqual([]);
  });

  it("treats a new flag's whole set as an addition", () => {
    expect(
      addedTargetingProjects(
        {},
        { project: "prj_b", targetingProjects: ["prj_a"] },
      ),
    ).toEqual(["prj_a"]);
  });
});

describe("holdsTargetingDestination", () => {
  const permissions = (granted: string[] | "all") => ({
    canTargetFeatureProjects: jest.fn((projects: string[] | "all") =>
      granted === "all"
        ? true
        : projects !== "all" && projects.every((p) => granted.includes(p)),
    ),
  });

  it("does not consult permissions when nothing is added", () => {
    const perms = permissions([]);
    expect(
      holdsTargetingDestination({
        permissions: perms,
        existing: { project: "prj_b", targetingProjects: ["prj_a"] },
        proposed: { project: "prj_b", targetingProjects: [] },
      }),
    ).toBe(true);
    expect(perms.canTargetFeatureProjects).not.toHaveBeenCalled();
  });

  it("asks for exactly the added projects", () => {
    const perms = permissions(["prj_c"]);
    expect(
      holdsTargetingDestination({
        permissions: perms,
        existing: { project: "prj_b", targetingProjects: ["prj_a"] },
        proposed: { project: "prj_b", targetingProjects: ["prj_a", "prj_c"] },
      }),
    ).toBe(true);
    expect(perms.canTargetFeatureProjects).toHaveBeenCalledWith(["prj_c"]);
    expect(
      holdsTargetingDestination({
        permissions: permissions(["prj_a"]),
        existing: { project: "prj_b" },
        proposed: { project: "prj_b", targetingProjects: ["prj_c"] },
      }),
    ).toBe(false);
  });

  it("asks for all-projects when it turns on", () => {
    expect(
      holdsTargetingDestination({
        permissions: permissions(["prj_a", "prj_c"]),
        existing: { project: "prj_b" },
        proposed: { project: "prj_b", targetingAllProjects: true },
      }),
    ).toBe(false);
    expect(
      holdsTargetingDestination({
        permissions: permissions("all"),
        existing: { project: "prj_b" },
        proposed: { project: "prj_b", targetingAllProjects: true },
      }),
    ).toBe(true);
  });
});

describe("holdsTargetingDestination with opted-out projects", () => {
  const all = { canTargetFeatureProjects: () => true };

  it("refuses a newly added project that does not allow targeting", () => {
    expect(
      holdsTargetingDestination({
        permissions: all,
        existing: { project: "prj_b" },
        proposed: { project: "prj_b", targetingProjects: ["prj_a"] },
        optedOut: ["prj_a"],
      }),
    ).toBe(false);
  });

  it("leaves an existing target alone", () => {
    expect(
      holdsTargetingDestination({
        permissions: all,
        existing: { project: "prj_b", targetingProjects: ["prj_a"] },
        proposed: { project: "prj_b", targetingProjects: ["prj_a", "prj_c"] },
        optedOut: ["prj_a"],
      }),
    ).toBe(true);
  });

  it("blocks all-projects while any project opts out", () => {
    expect(
      holdsTargetingDestination({
        permissions: all,
        existing: { project: "prj_b" },
        proposed: { project: "prj_b", targetingAllProjects: true },
        optedOut: ["prj_z"],
      }),
    ).toBe(false);
  });
});

describe("withStagedTargeting", () => {
  it("overlays only the fields the envelope carries", () => {
    const live = {
      project: "prj_b",
      targetingAllProjects: false,
      targetingProjects: ["prj_a"],
    };
    expect(withStagedTargeting(live, undefined)).toEqual(live);
    expect(withStagedTargeting(live, { targetingProjects: ["prj_c"] })).toEqual(
      { ...live, targetingProjects: ["prj_c"] },
    );
    expect(withStagedTargeting(live, { targetingAllProjects: true })).toEqual({
      ...live,
      targetingAllProjects: true,
    });
  });
});

describe("assertTargetingDestination refusal messages", () => {
  const permissions = {
    canTargetFeatureProjects: () => true,
    throwPermissionError: (message?: string) => {
      throw new Error(message);
    },
  };

  it("names a refused project the caller asked for", () => {
    expect(() =>
      assertTargetingDestination({
        permissions,
        existing: { project: "prj_b" },
        proposed: { project: "prj_b", targetingProjects: ["prj_a"] },
        optedOut: ["prj_a"],
      }),
    ).toThrow("prj_a does not allow targeting");
  });

  it("does not name opted-out projects when all projects was asked for", () => {
    expect(() =>
      assertTargetingDestination({
        permissions,
        existing: { project: "prj_b" },
        proposed: { project: "prj_b", targetingAllProjects: true },
        optedOut: ["prj_hidden"],
      }),
    ).toThrow(
      "Cannot target all projects: one or more projects do not allow targeting",
    );
    expect(() =>
      assertTargetingDestination({
        permissions,
        existing: { project: "prj_b" },
        proposed: { project: "prj_b", targetingAllProjects: true },
        optedOut: ["prj_hidden"],
      }),
    ).not.toThrow("prj_hidden");
  });
});
