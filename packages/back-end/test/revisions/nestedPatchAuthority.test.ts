import {
  getConstantRevisionChange,
  jsonPatchOperationValidator,
} from "shared/enterprise";
import {
  buildMergeDesiredState,
  buildPatchOps,
} from "back-end/src/revisions/util";

/**
 * A nested JSON-patch path could bypass the environment-scoped publish gate.
 *
 * Two appliers read a revision's `proposedChanges` and they disagree about nested
 * paths. The AUTHORITY side — `getConstantRevisionChange`, which feeds
 * `publishFootprint`, which is the footprint `assertCanPublishRevision` narrows on —
 * goes through `applyTopLevelPatchOps`, whose loop `continue`s on any path with more
 * than one segment. The WRITE side, `buildMergeDesiredState` → fast-json-patch,
 * applies them in full.
 *
 * `{op:"replace", path:"/environmentValues/production", value:"…"}` therefore
 * produced an EMPTY footprint — which SKIPS the environment check rather than
 * narrowing it — while the publish wrote production. A caller holding draft rights
 * and publish limited to `dev` could send that to
 * `PUT /revision/:id/proposed-changes` (which gates on project-scoped draft
 * authority only, and writes the ops verbatim) and land a production change.
 *
 * Closed at the validator: every internal writer emits top-level paths already
 * (`buildPatchOps` builds `/${key}`), so the raw-ops endpoint was the only way one
 * got in. The first two cases below pin the gate; the third pins the DIVERGENCE
 * itself, so that if anyone ever relaxes the path rule the underlying hazard is
 * still described.
 */

describe("revision patch paths are constrained to top level", () => {
  const nested = {
    op: "replace" as const,
    path: "/environmentValues/production",
    value: "MALICIOUS",
  };

  it("rejects a nested path", () => {
    const res = jsonPatchOperationValidator.safeParse(nested);
    expect(res.success).toBe(false);
  });

  it("accepts the top-level shape every writer actually emits", () => {
    // The control. `buildPatchOps` emits exactly this, so a rule that rejected
    // everything would break every ordinary edit — and would still pass the case
    // above.
    expect(
      jsonPatchOperationValidator.safeParse({
        op: "replace",
        path: "/environmentValues",
        value: { dev: "d", production: "p" },
      }).success,
    ).toBe(true);
    expect(
      jsonPatchOperationValidator.safeParse({
        op: "remove",
        path: "/schema",
      }).success,
    ).toBe(true);
  });

  /**
   * A characterization test: it asserts CURRENT behaviour, including the buggy half,
   * and its job is to say what its own failure means.
   *
   * It calls the two appliers DIRECTLY, so it does not go through the validator —
   * relaxing the path constraint above would not make it fail. What makes it fail is
   * the two appliers being made to AGREE.
   *
   * So if this goes red:
   *  - Did the fail-closed footprint land (the systemic cure — unify the appliers, or
   *    have the authority side refuse paths it cannot resolve)? Then this test has
   *    done its job. DELETE IT.
   *  - Otherwise something changed one applier and not the other, and the divergence
   *    this documents is back. Fix that.
   */
  it("documents the divergence the path constraint exists to contain", () => {
    const snapshot = {
      id: "c",
      key: "c",
      project: "",
      type: "string",
      value: "v",
      environmentValues: { dev: "old", production: "old" },
    };

    const footprint = getConstantRevisionChange(
      snapshot as never,
      [nested] as never,
    ).changedEnvironments;
    const desired = buildMergeDesiredState(
      snapshot as never,
      snapshot as never,
      [nested] as never,
      new Set(["environmentValues", "value"]),
    ) as Record<string, unknown>;

    expect({
      // Empty — and an empty footprint SKIPS the environment check.
      footprintGatingAuthority: footprint,
      // ...while the write applies it.
      whatPublishWouldWrite: desired.environmentValues,
    }).toEqual({
      footprintGatingAuthority: [],
      whatPublishWouldWrite: { dev: "old", production: "MALICIOUS" },
    });
  });

  it("buildPatchOps refuses to manufacture a nested path", () => {
    // The door is the validator; this is the one place the server MANUFACTURES ops,
    // and its output never passes back through validation. Closed by convention
    // today (every caller destructures named fields) — enforced here, so the first
    // caller that spreads a client object into `changes` fails loudly instead of
    // reopening the bypass from the inside.
    expect(() =>
      buildPatchOps({ "environmentValues/production": "x" }),
    ).toThrow(/may not contain/i);
    // ...and still builds the ordinary shape.
    expect(buildPatchOps({ value: "v" })).toEqual([
      { op: "replace", path: "/value", value: "v" },
    ]);
  });

  it("and the top-level equivalent DOES narrow the footprint", () => {
    // The other half: the gate works correctly for the shape writers emit, so the
    // bug was the nested path specifically and not the footprint machinery.
    const snapshot = {
      id: "c",
      key: "c",
      project: "",
      type: "string",
      value: "v",
      environmentValues: { dev: "old", production: "old" },
    };

    expect(
      getConstantRevisionChange(
        snapshot as never,
        [
          {
            op: "replace",
            path: "/environmentValues",
            value: { dev: "old", production: "NEW" },
          },
        ] as never,
      ).changedEnvironments,
    ).toEqual(["production"]);
  });
});
