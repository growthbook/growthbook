// Destination authority follows the operation: publishing a draft uses publish;
// landing a direct revert uses revert.

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
  it("publishing a relocating pure-revert draft demands destination publish", async () => {
    await expect(
      assertCanPublishRevision(
        contextGranting(["revert"]),
        revision,
        revision.target.snapshot,
      ),
    ).rejects.toThrow("permission denied");
  });

  it("passes a staged publish with destination publish authority", async () => {
    await expect(
      assertCanPublishRevision(
        contextGranting(["publish"]),
        revision,
        revision.target.snapshot,
      ),
    ).resolves.toBeUndefined();
  });

  it("passes a direct revert with destination revert authority", async () => {
    await expect(
      assertCanPublishRevision(
        contextGranting(["revert"]),
        revision,
        revision.target.snapshot,
        "revert",
      ),
    ).resolves.toBeUndefined();
  });

  it("refuses a direct revert without destination revert authority", async () => {
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
