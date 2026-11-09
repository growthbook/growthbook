import { storedVersionGuard } from "back-end/src/util/storedVersionGuard";

describe("storedVersionGuard", () => {
  it("guards on a stored dateUpdated", () => {
    const dateUpdated = new Date("2026-01-02T00:00:00Z");
    expect(
      storedVersionGuard({
        dateCreated: new Date("2026-01-01T00:00:00Z"),
        dateUpdated,
      } as { dateUpdated?: unknown }),
    ).toEqual({ dateUpdated });
  });

  it("matches a legacy doc's missing dateUpdated, not its dateCreated", () => {
    // Migrations fill dateUpdated from dateCreated in memory only, so a guard
    // on that value would never match the stored doc.
    expect(
      storedVersionGuard({
        dateCreated: new Date("2026-01-01T00:00:00Z"),
      } as { dateUpdated?: unknown }),
    ).toEqual({ dateUpdated: null });
  });

  it("matches a stored null dateUpdated", () => {
    expect(storedVersionGuard({ dateUpdated: null })).toEqual({
      dateUpdated: null,
    });
  });
});
