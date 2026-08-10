// The atom a RELOCATION demands over the destination is the verb of the
// OPERATION, not whether the change is a pure revert (flag-family-authority.md):
//
//   Publishing a draft      -> destination `publish`   (even a pure-revert draft)
//   Landing a direct revert -> destination `revert`
//
// assertCanPublishRevision takes that atom as an explicit argument defaulting to
// "publish" — the staged publish callers use the default; only landDirectChange
// passes "revert". The pure-revert status affects the SOURCE-side landing
// exemption (assertCanLandRevision), which is mocked out here so only the
// move-destination atom is under test.
//
// The move check is the sole move-authority decision (publishRevisionInner's
// duplicate was removed), so these cases pin it for both operations.

jest.mock("back-end/src/revisions", () => ({
  getAdapter: () => ({
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
  isPureRevertRevision: jest.fn(async () => true),
}));

import type { Revision } from "shared/enterprise";
import { assertCanPublishRevision } from "back-end/src/revisions/revisionActions";
import type { Context } from "back-end/src/models/BaseModel";

// A relocation: snapshot is in the source project, the proposed change sets the
// destination project. It is also a pure revert (the mock), which under the OLD
// rule would have wrongly downgraded a staged publish to revert authority.
const revision = {
  target: {
    type: "constant",
    snapshot: { id: "cst_1", project: "source" },
    proposedChanges: [
      { op: "replace", path: "/project", value: "destination" },
    ],
  },
  revertedFrom: "rev_old",
} as unknown as Revision;

// Grants `action` over the DESTINATION project only, so the caller holds neither
// atom on the source and passes only if the move check asks the atom listed.
function contextGranting(grants: string[]): Context {
  return {
    permissions: {
      canRevisionAction: (
        _model: string,
        action: string,
        obj: { project?: string; projects?: string[] },
      ) => {
        const asked = obj.projects ?? (obj.project ? [obj.project] : []);
        return (
          asked.length === 1 &&
          asked[0] === "destination" &&
          grants.includes(action)
        );
      },
      throwPermissionError: jest.fn(() => {
        throw new Error("permission denied");
      }),
    },
  } as unknown as Context;
}

describe("move-destination authority follows the operation, not pure-revert status", () => {
  it("PUBLISHING a relocating pure-revert draft demands destination PUBLISH", async () => {
    // The default operation is a staged publish. Destination revert authority is
    // NOT enough even though the change is a pure revert.
    await expect(
      assertCanPublishRevision(
        contextGranting(["revert"]),
        revision,
        revision.target.snapshot,
      ),
    ).rejects.toThrow("permission denied");
  });

  it("...and passes with destination PUBLISH authority", async () => {
    await expect(
      assertCanPublishRevision(
        contextGranting(["publish"]),
        revision,
        revision.target.snapshot,
      ),
    ).resolves.toBeUndefined();
  });

  it("a DIRECT revert (explicit revert action) passes with only destination REVERT", async () => {
    await expect(
      assertCanPublishRevision(
        contextGranting(["revert"]),
        revision,
        revision.target.snapshot,
        "revert",
      ),
    ).resolves.toBeUndefined();
  });

  it("a direct revert is still refused without even destination REVERT", async () => {
    await expect(
      assertCanPublishRevision(
        contextGranting([]),
        revision,
        revision.target.snapshot,
        "revert",
      ),
    ).rejects.toThrow("permission denied");
  });
});
