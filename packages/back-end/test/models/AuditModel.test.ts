import {
  encodeAuditCursor,
  parseAuditCursor,
} from "back-end/src/models/AuditModel";

describe("audit history cursors", () => {
  const before = new Date("2026-11-06T12:34:56.789Z");

  it("round-trips the instant and the ids seen at it", () => {
    const cursor = encodeAuditCursor({
      before,
      seenIds: ["aud_2abc", "aud_2def"],
    });
    expect(cursor).toBe("2026-11-06T12:34:56.789Z_aud_2abc,aud_2def");
    expect(parseAuditCursor(cursor)).toEqual({
      before,
      seenIds: ["aud_2abc", "aud_2def"],
    });
  });

  it("reads a bare ISO date as a cursor with nothing seen", () => {
    expect(parseAuditCursor(before.toISOString())).toEqual({
      before,
      seenIds: [],
    });
  });

  it("returns undefined for a missing cursor", () => {
    expect(parseAuditCursor(undefined)).toBeUndefined();
    expect(parseAuditCursor("")).toBeUndefined();
  });

  it("rejects a cursor whose date can't be parsed", () => {
    expect(() => parseAuditCursor("not-a-date_aud_2abc")).toThrow(
      "Invalid cursor",
    );
  });
});
