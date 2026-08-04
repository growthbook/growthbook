import {
  holdsMoveDestination,
  isMove,
  moveDestination,
} from "back-end/src/revisions/moveAuthority";

/**
 * A relocation takes authority on BOTH sides, and every publish/draft path that
 * can move an entity routes its destination check through here. These cases pin
 * the part that is easy to get wrong per call site: which project the check
 * actually asks about.
 */

function permissionsAllowing(allowed: { projects: string[] }[]) {
  return {
    canRevisionAction: jest.fn(
      (
        _model: string,
        _action: string,
        obj: { project?: string; projects?: string[] },
        _envs: string[] = [],
      ) => {
        const asked = obj.projects ?? (obj.project ? [obj.project] : []);
        return allowed.some(
          (a) =>
            a.projects.length === asked.length &&
            a.projects.every((p) => asked.includes(p)),
        );
      },
    ),
  };
}

describe("isMove", () => {
  it("treats absent, null and empty-string project as the same non-project", () => {
    expect(isMove({}, { project: "" })).toBe(false);
    expect(isMove({ project: "" }, {})).toBe(false);
    expect(isMove({ project: undefined }, { project: "" })).toBe(false);
  });

  it("detects a scalar project change in either direction", () => {
    expect(isMove({ project: "a" }, { project: "b" })).toBe(true);
    expect(isMove({}, { project: "b" })).toBe(true);
    expect(isMove({ project: "a" }, { project: "" })).toBe(true);
  });

  it("compares multi-project lists by membership, not order", () => {
    expect(isMove({ projects: ["a", "b"] }, { projects: ["b", "a"] })).toBe(
      false,
    );
    expect(isMove({ projects: ["a"] }, { projects: ["a", "b"] })).toBe(true);
    expect(isMove({ projects: [] }, { projects: [] })).toBe(false);
  });
});

describe("moveDestination", () => {
  it("names the single destination project for scalar-scoped entities", () => {
    expect(moveDestination({ project: "a" }, { project: "b" })).toEqual({
      projects: ["b"],
    });
  });

  it("resolves a move to global as no projects, not as a project named ''", () => {
    expect(moveDestination({ project: "a" }, { project: "" })).toEqual({
      projects: [],
    });
  });

  it("names the whole proposed list for multi-project entities", () => {
    expect(
      moveDestination({ projects: ["a"] }, { projects: ["b", "c"] }),
    ).toEqual({ projects: ["b", "c"] });
  });

  it("keeps the list shape when a multi-project entity is emptied", () => {
    expect(moveDestination({ projects: ["a"] }, { projects: [] })).toEqual({
      projects: [],
    });
  });
});

describe("holdsMoveDestination", () => {
  it("passes vacuously when nothing moves, so callers can call it unconditionally", () => {
    const permissions = permissionsAllowing([]);
    expect(
      holdsMoveDestination({
        permissions,
        model: "config",
        action: "publish",
        existing: { project: "a" },
        proposed: { project: "a" },
      }),
    ).toBe(true);
    expect(permissions.canRevisionAction).not.toHaveBeenCalled();
  });

  it("asks about the DESTINATION, never the source", () => {
    const permissions = permissionsAllowing([{ projects: ["source"] }]);
    expect(
      holdsMoveDestination({
        permissions,
        model: "config",
        action: "publish",
        existing: { project: "source" },
        proposed: { project: "destination" },
      }),
    ).toBe(false);
    expect(permissions.canRevisionAction).toHaveBeenCalledWith(
      "config",
      "publish",
      { projects: ["destination"] },
      [],
    );
  });

  it("allows the move when the caller holds the destination", () => {
    expect(
      holdsMoveDestination({
        permissions: permissionsAllowing([{ projects: ["destination"] }]),
        model: "constant",
        action: "draft",
        existing: { project: "source" },
        proposed: { project: "destination" },
      }),
    ).toBe(true);
  });

  it("carries the environment footprint through to the check", () => {
    const permissions = permissionsAllowing([{ projects: ["b"] }]);
    holdsMoveDestination({
      permissions,
      model: "constant",
      action: "publish",
      existing: { project: "a" },
      proposed: { project: "b" },
      environments: ["production"],
    });
    expect(permissions.canRevisionAction).toHaveBeenCalledWith(
      "constant",
      "publish",
      { projects: ["b"] },
      ["production"],
    );
  });

  it("checks every destination project of a multi-project move at once", () => {
    const permissions = permissionsAllowing([{ projects: ["b"] }]);
    // Holding only one of the two destinations is not enough.
    expect(
      holdsMoveDestination({
        permissions,
        model: "saved-group",
        action: "draft",
        existing: { projects: ["a"] },
        proposed: { projects: ["b", "c"] },
      }),
    ).toBe(false);
  });
});
