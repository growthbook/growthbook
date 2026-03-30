import {
  clearPendingToolArtifactsForConversation,
  peekPendingToolArtifact,
  setPendingToolArtifact,
  takePendingToolArtifact,
} from "back-end/src/enterprise/services/pending-tool-artifacts";

describe("pending-tool-artifacts", () => {
  it("peek does not remove; take removes; clear removes all for conversation", () => {
    const cid = "c1";
    setPendingToolArtifact(cid, "t1", { summary: "a", x: 1 });
    expect(peekPendingToolArtifact(cid, "t1")?.summary).toBe("a");
    expect(peekPendingToolArtifact(cid, "t1")?.summary).toBe("a");
    expect(takePendingToolArtifact(cid, "t1")?.summary).toBe("a");
    expect(peekPendingToolArtifact(cid, "t1")).toBeUndefined();

    setPendingToolArtifact(cid, "t2", { summary: "b" });
    setPendingToolArtifact(cid, "t3", { summary: "c" });
    clearPendingToolArtifactsForConversation(cid);
    expect(peekPendingToolArtifact(cid, "t2")).toBeUndefined();
    expect(peekPendingToolArtifact(cid, "t3")).toBeUndefined();
  });
});
