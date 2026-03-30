import {
  clearPendingSnapshotsForConversation,
  getPendingSnapshot,
  registerPendingSnapshot,
} from "back-end/src/enterprise/services/pending-snapshot-lookup";

describe("pending-snapshot-lookup", () => {
  it("resolves by conversation and snapshot id and clears per conversation", () => {
    const cid = "conv-1";
    registerPendingSnapshot(cid, {
      summary: "s",
      snapshotId: "snap_x_1",
      config: { a: 1 },
      exploration: null,
      resultCsv: "a,b",
    });
    expect(getPendingSnapshot(cid, "snap_x_1")?.summary).toBe("s");
    clearPendingSnapshotsForConversation(cid);
    expect(getPendingSnapshot(cid, "snap_x_1")).toBeUndefined();
  });
});
