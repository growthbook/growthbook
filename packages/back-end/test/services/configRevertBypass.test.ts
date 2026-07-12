import { Revision } from "shared/enterprise";
import {
  isValidRevertBypass,
  revertRestoresTargetSnapshot,
} from "back-end/src/services/configRevertBypass";

const mergedRevision = (overrides: Partial<Revision> = {}): Revision =>
  ({
    id: "rev_1",
    authorId: "u_1",
    version: 3,
    status: "merged",
    reviews: [],
    activityLog: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: "org_1",
    target: {
      type: "config",
      id: "cfg_1",
      snapshot: {},
      proposedChanges: [],
    },
    ...overrides,
  }) as unknown as Revision;

describe("isValidRevertBypass", () => {
  it("grants the exemption for a merged revision of the same entity with the setting on", () => {
    expect(
      isValidRevertBypass({
        revision: mergedRevision(),
        entityType: "config",
        entityId: "cfg_1",
        revertsBypassApproval: true,
      }),
    ).toBe(true);
  });

  it("works for constants too (generalized over entity type)", () => {
    expect(
      isValidRevertBypass({
        revision: mergedRevision({
          target: {
            type: "constant",
            id: "const_1",
            snapshot: {} as never,
            proposedChanges: [],
          } as unknown as Revision["target"],
        }),
        entityType: "constant",
        entityId: "const_1",
        revertsBypassApproval: true,
      }),
    ).toBe(true);
  });

  it("denies when the org setting is off", () => {
    expect(
      isValidRevertBypass({
        revision: mergedRevision(),
        entityType: "config",
        entityId: "cfg_1",
        revertsBypassApproval: false,
      }),
    ).toBe(false);
  });

  it("denies when the referenced revision does not exist", () => {
    expect(
      isValidRevertBypass({
        revision: null,
        entityType: "config",
        entityId: "cfg_1",
        revertsBypassApproval: true,
      }),
    ).toBe(false);
  });

  it("denies when the referenced revision is not merged", () => {
    for (const status of ["draft", "approved", "discarded"] as const) {
      expect(
        isValidRevertBypass({
          revision: mergedRevision({ status }),
          entityType: "config",
          entityId: "cfg_1",
          revertsBypassApproval: true,
        }),
      ).toBe(false);
    }
  });

  it("denies when the revision targets a different entity id", () => {
    expect(
      isValidRevertBypass({
        revision: mergedRevision({
          target: {
            type: "config",
            id: "cfg_OTHER",
            snapshot: {} as never,
            proposedChanges: [],
          } as Revision["target"],
        }),
        entityType: "config",
        entityId: "cfg_1",
        revertsBypassApproval: true,
      }),
    ).toBe(false);
  });

  it("denies when the revision targets a different entity type", () => {
    // A constant revision can't launder a config bypass, even with a matching id.
    expect(
      isValidRevertBypass({
        revision: mergedRevision({
          target: {
            type: "constant",
            id: "cfg_1",
            snapshot: {} as never,
            proposedChanges: [],
          } as unknown as Revision["target"],
        }),
        entityType: "config",
        entityId: "cfg_1",
        revertsBypassApproval: true,
      }),
    ).toBe(false);
  });
});

describe("revertRestoresTargetSnapshot", () => {
  it("accepts when every changed field lands on the target's value", () => {
    expect(
      revertRestoresTargetSnapshot({
        changedFields: ["value", "name"],
        proposedSnapshot: { value: '{"a":1}', name: "Old", extra: "ignored" },
        targetSnapshot: { value: '{"a":1}', name: "Old" },
      }),
    ).toBe(true);
  });

  it("accepts an unarchive revert (archived:false vs a target that omits it)", () => {
    // Regression guard: false (falsy default) must equal absent (undefined).
    expect(
      revertRestoresTargetSnapshot({
        changedFields: ["archived", "value"],
        proposedSnapshot: { archived: false, value: '{"a":1}' },
        targetSnapshot: { value: '{"a":1}' }, // predates archival → no `archived`
      }),
    ).toBe(true);
  });

  it("rejects an arbitrary value fronted alongside a valid revert id", () => {
    expect(
      revertRestoresTargetSnapshot({
        changedFields: ["value"],
        proposedSnapshot: { value: '{"evil":true}' },
        targetSnapshot: { value: '{"a":1}' },
      }),
    ).toBe(false);
  });

  it("rejects laundering an archive (archived:true) against an unarchived target", () => {
    expect(
      revertRestoresTargetSnapshot({
        changedFields: ["archived"],
        proposedSnapshot: { archived: true },
        targetSnapshot: {}, // target not archived
      }),
    ).toBe(false);
  });

  it("rejects extensible:false against a target that omits extensible", () => {
    // Only `archived` gets the false↔absent collapse. `extensible` absent means
    // "inherit the org default" (permissive), so explicit false is distinct and
    // must NOT launder past review as a fake revert.
    expect(
      revertRestoresTargetSnapshot({
        changedFields: ["extensible"],
        proposedSnapshot: { extensible: false },
        targetSnapshot: {},
      }),
    ).toBe(false);
  });

  it("does not let an empty value impersonate a non-empty target", () => {
    expect(
      revertRestoresTargetSnapshot({
        changedFields: ["parent"],
        proposedSnapshot: { parent: "" },
        targetSnapshot: { parent: "base_cfg" },
      }),
    ).toBe(false);
  });

  it("supports a partial revert (only the listed fields are checked)", () => {
    expect(
      revertRestoresTargetSnapshot({
        changedFields: ["value"],
        proposedSnapshot: { value: '{"a":1}', name: "Diverged" },
        targetSnapshot: { value: '{"a":1}', name: "Original" },
      }),
    ).toBe(true);
  });
});
