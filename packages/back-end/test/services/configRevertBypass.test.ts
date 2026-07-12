import { Revision } from "shared/enterprise";
import { isValidRevertBypass } from "back-end/src/services/configRevertBypass";

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
