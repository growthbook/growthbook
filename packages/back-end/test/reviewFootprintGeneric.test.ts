import type { Revision } from "shared/types/revision";
import { reviewFootprintFor } from "back-end/src/revisions/revisionActions";
import type { Context } from "back-end/src/models/BaseModel";

const context = {
  org: {
    id: "org_1",
    settings: {
      environments: [{ id: "dev" }, { id: "staging" }, { id: "production" }],
    },
  },
} as unknown as Context;

const revision = (
  snapshot: Record<string, unknown>,
  proposedChanges: unknown,
): Pick<Revision, "target"> =>
  ({
    target: { type: "constant", snapshot, proposedChanges },
  }) as unknown as Pick<Revision, "target">;

const constant = (over: Record<string, unknown> = {}) => ({
  id: "const_1",
  key: "flag_limit",
  value: "10",
  environmentValues: { dev: "1", production: "2" },
  archived: false,
  ...over,
});

describe("review footprint for generic revision entities", () => {
  it("scopes review to the environments the change touches", () => {
    // Patches are top-level: the whole environmentValues map is replaced.
    const r = revision(constant(), [
      {
        op: "replace",
        path: "/environmentValues",
        value: { dev: "5", production: "2" },
      },
    ]);

    expect(reviewFootprintFor(context, r)).toEqual(["dev"]);
  });

  // A base value carries no environment binding, and the review branch of
  // canRevisionAction reads [] as "needs authority no env limit restricts".
  it("returns an unbound footprint for a base value change", () => {
    const r = revision(constant(), [
      { op: "replace", path: "/value", value: "99" },
    ]);

    expect(reviewFootprintFor(context, r)).toEqual([]);
  });

  it("treats an archive flip as reaching every served environment", () => {
    const r = revision(constant(), [
      { op: "replace", path: "/archived", value: true },
    ]);

    expect(reviewFootprintFor(context, r).sort()).toEqual([
      "dev",
      "production",
      "staging",
    ]);
  });

  it("names every changed environment, not just the first", () => {
    const r = revision(constant(), [
      {
        op: "replace",
        path: "/environmentValues",
        value: { dev: "5", production: "6" },
      },
    ]);

    expect(reviewFootprintFor(context, r).sort()).toEqual([
      "dev",
      "production",
    ]);
  });

  it("returns no environments when nothing changed", () => {
    const r = revision(constant(), []);

    expect(reviewFootprintFor(context, r)).toEqual([]);
  });
});
