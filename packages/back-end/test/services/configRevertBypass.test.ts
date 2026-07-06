import { Revision } from "shared/enterprise";
import { isValidRevertBypass } from "back-end/src/services/configRevertBypass";

const mergedConfigRevision = (overrides: Partial<Revision> = {}): Revision =>
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
  it("grants the exemption for a merged config revision of the same config with the setting on", () => {
    expect(
      isValidRevertBypass({
        revision: mergedConfigRevision(),
        configId: "cfg_1",
        revertsBypassApproval: true,
      }),
    ).toBe(true);
  });

  it("denies when the org setting is off", () => {
    expect(
      isValidRevertBypass({
        revision: mergedConfigRevision(),
        configId: "cfg_1",
        revertsBypassApproval: false,
      }),
    ).toBe(false);
  });

  it("denies when the referenced revision does not exist", () => {
    expect(
      isValidRevertBypass({
        revision: null,
        configId: "cfg_1",
        revertsBypassApproval: true,
      }),
    ).toBe(false);
  });

  it("denies when the referenced revision is not merged", () => {
    for (const status of ["draft", "approved", "discarded"] as const) {
      expect(
        isValidRevertBypass({
          revision: mergedConfigRevision({ status }),
          configId: "cfg_1",
          revertsBypassApproval: true,
        }),
      ).toBe(false);
    }
  });

  it("denies when the revision targets a different config", () => {
    expect(
      isValidRevertBypass({
        revision: mergedConfigRevision({
          target: {
            type: "config",
            id: "cfg_OTHER",
            snapshot: {} as never,
            proposedChanges: [],
          } as Revision["target"],
        }),
        configId: "cfg_1",
        revertsBypassApproval: true,
      }),
    ).toBe(false);
  });

  it("denies when the revision targets a non-config entity", () => {
    expect(
      isValidRevertBypass({
        revision: mergedConfigRevision({
          target: {
            type: "constant",
            id: "cfg_1",
            snapshot: {} as never,
            proposedChanges: [],
          } as unknown as Revision["target"],
        }),
        configId: "cfg_1",
        revertsBypassApproval: true,
      }),
    ).toBe(false);
  });
});
