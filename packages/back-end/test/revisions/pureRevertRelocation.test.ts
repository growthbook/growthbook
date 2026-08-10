// The move-destination check in assertCanPublishRevision selects its authority
// atom from whether the revision is a PURE REVERT: a revert that also relocates
// the entity lands under REVERT authority (the atom the landing exemption already
// granted it), not PUBLISH. Hardcoding "publish" over-asked and blocked a
// legitimate reverter who happened to move the entity.
//
// The collaborators are mocked so only the action SELECTION is under test:
// isPureRevertRevision decides the branch, assertCanLandRevision/footprint are
// neutralized, and the REAL holdsMoveDestination + isMove carry the chosen atom
// through to a permissions stub that answers differently for "revert" vs
// "publish". publishRevisionInner has the identical selection at its own move
// check; this pins the shared rule.

jest.mock("back-end/src/revisions", () => ({
  getAdapter: () => ({
    // publishFootprint is optional; the resolvePublishFootprint mock ignores it.
    publishFootprint: undefined,
  }),
}));
jest.mock("back-end/src/revisions/revisionPublishEnvironments", () => ({
  resolvePublishFootprint: () => [] as string[],
}));
jest.mock("back-end/src/revisions/landAuthority", () => ({
  assertCanLandRevision: jest.fn(async () => undefined),
}));
jest.mock("back-end/src/revisions/revertPurity", () => ({
  isPureRevertRevision: jest.fn(),
}));

import type { Revision } from "shared/enterprise";
import { assertCanPublishRevision } from "back-end/src/revisions/revisionActions";
import { isPureRevertRevision as isPureRevertRevisionImpl } from "back-end/src/revisions/revertPurity";
import type { Context } from "back-end/src/models/BaseModel";

const isPureRevert = isPureRevertRevisionImpl as jest.Mock;

// A relocation: snapshot is in the source project, the proposed change sets the
// destination project.
const revision = {
  target: {
    type: "constant",
    snapshot: { id: "cst_1", project: "source" },
    proposedChanges: [
      { op: "replace", path: "/project", value: "destination" },
    ],
  },
} as unknown as Revision;

// Grants `action` over the DESTINATION project only, so the caller holds neither
// atom over the source and can pass ONLY if the move check asks the atom listed.
function contextGranting(grants: { action: string }[]): Context {
  const throwPermissionError = jest.fn(() => {
    throw new Error("permission denied");
  });
  return {
    permissions: {
      canRevisionAction: (
        _model: string,
        action: string,
        obj: { project?: string; projects?: string[] },
        _envs: string[] = [],
      ) => {
        const asked = obj.projects ?? (obj.project ? [obj.project] : []);
        return (
          asked.length === 1 &&
          asked[0] === "destination" &&
          grants.some((g) => g.action === action)
        );
      },
      throwPermissionError,
    },
  } as unknown as Context;
}

describe("pure-revert relocation takes revert authority, not publish", () => {
  it("a relocating pure revert passes with only destination REVERT authority", async () => {
    isPureRevert.mockResolvedValue(true);
    await expect(
      assertCanPublishRevision(
        contextGranting([{ action: "revert" }]),
        revision,
        revision.target.snapshot,
      ),
    ).resolves.toBeUndefined();
  });

  it("the same relocation is refused when the caller lacks even revert on the destination", async () => {
    isPureRevert.mockResolvedValue(true);
    await expect(
      assertCanPublishRevision(
        contextGranting([]),
        revision,
        revision.target.snapshot,
      ),
    ).rejects.toThrow("permission denied");
  });

  it("a NON-revert relocation still demands publish authority on the destination", async () => {
    // The control: publish-class moves must not be downgraded to revert. Holding
    // only revert on the destination is not enough for a plain publish-move.
    isPureRevert.mockResolvedValue(false);
    await expect(
      assertCanPublishRevision(
        contextGranting([{ action: "revert" }]),
        revision,
        revision.target.snapshot,
      ),
    ).rejects.toThrow("permission denied");
    // And it passes with publish authority.
    await expect(
      assertCanPublishRevision(
        contextGranting([{ action: "publish" }]),
        revision,
        revision.target.snapshot,
      ),
    ).resolves.toBeUndefined();
  });
});
