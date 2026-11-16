import { getConstantRevisionApprovalChange } from "../src/revisions/helpers";

// What a write to an approved Constant/Config revision changed, judged the way
// the approval reset needs it: an edit by its own delta, a rebase by what the
// draft still changes against its new snapshot.
describe("getConstantRevisionApprovalChange", () => {
  const snapshot = {
    value: "base",
    environmentValues: { dev: "d0", production: "p0" },
  };
  const devOnly = [
    {
      op: "replace" as const,
      path: "/environmentValues",
      value: { dev: "d1", production: "p0" },
    },
  ];
  const target = (proposedChanges: unknown, snap: unknown = snapshot) => ({
    snapshot: snap,
    proposedChanges,
  });

  it("an unchanged re-send changes nothing", () => {
    expect(
      getConstantRevisionApprovalChange(target(devOnly), target(devOnly)),
    ).toEqual({ valueChanged: false, changedEnvironments: [] });
  });

  it("adding an environment override counts only that environment", () => {
    const withProd = [
      {
        op: "replace" as const,
        path: "/environmentValues",
        value: { dev: "d1", production: "p1" },
      },
    ];
    expect(
      getConstantRevisionApprovalChange(target(devOnly), target(withProd)),
    ).toEqual({ valueChanged: false, changedEnvironments: ["production"] });
  });

  it("removing an approved override counts that environment too", () => {
    // The approval covered a dev change that will no longer publish.
    expect(
      getConstantRevisionApprovalChange(target(devOnly), target([])),
    ).toEqual({ valueChanged: false, changedEnvironments: ["dev"] });
  });

  it("a base value change is a value change; restating it is not", () => {
    const value = [{ op: "replace" as const, path: "/value", value: "v1" }];
    expect(
      getConstantRevisionApprovalChange(target([]), target(value)),
    ).toEqual({ valueChanged: true, changedEnvironments: [] });
    expect(
      getConstantRevisionApprovalChange(target(value), target(value)),
    ).toEqual({ valueChanged: false, changedEnvironments: [] });
  });

  it("a metadata-only edit changes nothing reviewable", () => {
    const renamed = [
      ...devOnly,
      { op: "replace" as const, path: "/name", value: "renamed" },
    ];
    expect(
      getConstantRevisionApprovalChange(target(devOnly), target(renamed)),
    ).toEqual({ valueChanged: false, changedEnvironments: [] });
  });

  it("config content fields count as value changes", () => {
    const schema = [
      {
        op: "replace" as const,
        path: "/schema",
        value: { type: "object", fields: [] },
      },
    ];
    expect(
      getConstantRevisionApprovalChange(target([]), target(schema)),
    ).toEqual({ valueChanged: true, changedEnvironments: [] });
  });

  it("object values compare by content", () => {
    const a = [{ op: "replace" as const, path: "/value", value: { k: 1 } }];
    const b = [{ op: "replace" as const, path: "/value", value: { k: 1 } }];
    expect(getConstantRevisionApprovalChange(target(a), target(b))).toEqual({
      valueChanged: false,
      changedEnvironments: [],
    });
  });

  it("an edit that touches ops the applier cannot read is the widest change", () => {
    const nested = [
      { op: "replace" as const, path: "/environmentValues/dev", value: "x" },
    ];
    expect(
      getConstantRevisionApprovalChange(target([]), target(nested)),
    ).toMatchObject({ valueChanged: true });
    // Left alone, they do not make an unrelated edit look like one.
    expect(
      getConstantRevisionApprovalChange(target(nested), target(nested)),
    ).toEqual({ valueChanged: false, changedEnvironments: [] });
  });

  it("a rebase is judged on what the draft still changes against the new snapshot", () => {
    // Live moved production upstream; the draft's own change is still dev only.
    const rebasedSnapshot = {
      value: "base",
      environmentValues: { dev: "d0", production: "p9" },
    };
    const rebasedOps = [
      {
        op: "replace" as const,
        path: "/environmentValues",
        value: { dev: "d1", production: "p9" },
      },
    ];
    expect(
      getConstantRevisionApprovalChange(
        target(devOnly),
        target(rebasedOps, rebasedSnapshot),
      ),
    ).toEqual({ valueChanged: false, changedEnvironments: ["dev"] });
    // Nothing of its own left after the rebase: no change to review.
    expect(
      getConstantRevisionApprovalChange(
        target(devOnly),
        target([], rebasedSnapshot),
      ),
    ).toEqual({ valueChanged: false, changedEnvironments: [] });
  });
});
