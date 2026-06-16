import { describe, it, expect } from "vitest";
import type { RevisionLog } from "shared/validators";
import {
  buildAnchoredCommentMap,
  buildDiffSnapshotEntries,
  captureDiffRefSnapshot,
  diffRefId,
  formatDiffRef,
  parseDiffRefs,
  splitDiffRefSegments,
  stripDiffRefs,
} from "@/components/Reviews/diffCommentRefs";

const logEntry = (
  overrides: Partial<RevisionLog> & { comment?: string },
): RevisionLog => {
  const { comment, ...rest } = overrides;
  return {
    id: "log_1",
    user: {
      type: "dashboard",
      id: "u1",
      name: "Bryce",
      email: "bryce@example.com",
    },
    timestamp: new Date("2026-06-01T00:00:00Z"),
    action: "Comment",
    subject: "",
    value: JSON.stringify({ comment: comment ?? "" }),
    ...rest,
  } as RevisionLog;
};

describe("formatDiffRef / parseDiffRefs", () => {
  it("round-trips a ref block through markdown", () => {
    const ref = { sectionKey: "rules", side: "R" as const, line: 12 };
    const block = formatDiffRef(ref, {
      lines: [
        { op: " ", text: '"id": "abc",' },
        { op: "-", text: '"type": "rollout",' },
        { op: "+", text: '"type": "force",' },
      ],
    });
    expect(block).toBe(
      [
        "```diff-ref rules:R12",
        '  "id": "abc",',
        '- "type": "rollout",',
        '+ "type": "force",',
        "```",
      ].join("\n"),
    );
    expect(parseDiffRefs(`${block}\n\nThis rule looks wrong`)).toEqual([ref]);
  });

  it("formats a bare ref block without a snapshot", () => {
    expect(formatDiffRef({ sectionKey: "rules", side: "L", line: 2 })).toBe(
      "```diff-ref rules:L2\n```",
    );
  });

  it("still parses legacy inline tokens", () => {
    const refs = parseDiffRefs(
      "See `diff:environmentsEnabled.production:L3` and also " +
        "`diff:rampAction.sched-1:R7`.",
    );
    expect(refs).toEqual([
      { sectionKey: "environmentsEnabled.production", side: "L", line: 3 },
      { sectionKey: "rampAction.sched-1", side: "R", line: 7 },
    ]);
  });

  it("ignores malformed tokens", () => {
    expect(parseDiffRefs("`diff:rules:X12` `diff:rules:R` `diff::R1`")).toEqual(
      [],
    );
    expect(parseDiffRefs("diff:rules:R12 without backticks")).toEqual([]);
  });

  it("diffRefId is stable and side-sensitive", () => {
    expect(diffRefId({ sectionKey: "rules", side: "R", line: 12 })).toBe(
      "rules:R12",
    );
    expect(diffRefId({ sectionKey: "rules", side: "L", line: 12 })).toBe(
      "rules:L12",
    );
  });
});

describe("diff snapshots", () => {
  const a = ["{", '  "type": "rollout",', '  "coverage": 0.5', "}"].join("\n");
  const b = ["{", '  "type": "force",', '  "value": "true"', "}"].join("\n");

  it("builds entries with per-side line numbers", () => {
    const entries = buildDiffSnapshotEntries(a, b);
    expect(entries).toEqual([
      { op: " ", text: "{", lLine: 1, rLine: 1 },
      { op: "-", text: '  "type": "rollout",', lLine: 2 },
      { op: "-", text: '  "coverage": 0.5', lLine: 3 },
      { op: "+", text: '  "type": "force",', rLine: 2 },
      { op: "+", text: '  "value": "true"', rLine: 3 },
      { op: " ", text: "}", lLine: 4, rLine: 4 },
    ]);
  });

  it("captures a before+after window around the anchor", () => {
    const entries = buildDiffSnapshotEntries(a, b);
    const snapshot = captureDiffRefSnapshot(entries, "R", 2);
    expect(snapshot.lines).toEqual([
      { op: "-", text: '  "type": "rollout",', anchored: false },
      { op: "-", text: '  "coverage": 0.5', anchored: false },
      { op: "+", text: '  "type": "force",', anchored: true },
      { op: "+", text: '  "value": "true"', anchored: false },
      { op: " ", text: "}", anchored: false },
    ]);
  });

  it("returns an empty snapshot for an unknown line", () => {
    const entries = buildDiffSnapshotEntries(a, b);
    expect(captureDiffRefSnapshot(entries, "L", 99)).toEqual({ lines: [] });
  });

  it("round-trips snapshot lines through the markdown block", () => {
    const entries = buildDiffSnapshotEntries(a, b);
    const ref = { sectionKey: "rules", side: "R" as const, line: 2 };
    const snapshot = captureDiffRefSnapshot(entries, "R", 2);
    const block = formatDiffRef(ref, snapshot);
    expect(block).toContain('+!   "type": "force",');
    const segments = splitDiffRefSegments(`Intro\n\n${block}\n\nOutro`);
    expect(segments).toEqual([
      { type: "markdown", text: "Intro\n\n" },
      { type: "ref", ref, snapshot },
      { type: "markdown", text: "\n\nOutro" },
    ]);
  });

  it("stripDiffRefs removes ref blocks and inline tokens", () => {
    const block = formatDiffRef(
      { sectionKey: "rules", side: "R", line: 2 },
      { lines: [{ op: "+", text: "x" }] },
    );
    expect(stripDiffRefs(`${block}\n\nLooks wrong to me`)).toBe(
      "Looks wrong to me",
    );
    expect(stripDiffRefs("`diff:rules:R2` hm")).toBe("hm");
  });
});

describe("buildAnchoredCommentMap", () => {
  it("maps comments, approvals, and change requests to their refs", () => {
    const map = buildAnchoredCommentMap([
      logEntry({ id: "a", comment: "`diff:rules:R2` hm" }),
      logEntry({
        id: "b",
        action: "Approved",
        comment: "`diff:defaultValue:L1` fine by me",
      }),
      logEntry({ id: "c", action: "publish", comment: "`diff:rules:R9`" }),
    ]);
    expect(map.get("rules:R2")?.logId).toBe("a");
    expect(map.get("defaultValue:L1")?.logId).toBe("b");
    // Non-comment actions never contribute anchors.
    expect(map.has("rules:R9")).toBe(false);
  });

  it("keeps only the most recent comment per spot", () => {
    const map = buildAnchoredCommentMap([
      logEntry({
        id: "old",
        comment: "`diff:rules:R2` first",
        timestamp: new Date("2026-06-01T00:00:00Z"),
      }),
      logEntry({
        id: "new",
        comment: "`diff:rules:R2` second",
        timestamp: new Date("2026-06-02T00:00:00Z"),
      }),
    ]);
    expect(map.size).toBe(1);
    expect(map.get("rules:R2")?.logId).toBe("new");
    expect(map.get("rules:R2")?.comment).toContain("second");
  });

  it("skips entries without a parseable comment body", () => {
    const map = buildAnchoredCommentMap([
      logEntry({ id: "x", value: "not json" }),
      logEntry({ id: "y", value: JSON.stringify({}) }),
    ]);
    expect(map.size).toBe(0);
  });

  it("captures user identity for ownership checks", () => {
    const map = buildAnchoredCommentMap([
      logEntry({ id: "a", comment: "`diff:rules:R2`" }),
    ]);
    expect(map.get("rules:R2")?.userId).toBe("u1");
    expect(map.get("rules:R2")?.userName).toBe("Bryce");
  });
});
