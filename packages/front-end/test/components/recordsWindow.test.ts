import {
  rowsWithinWindow,
  windowIsWithinLoaded,
} from "@/components/Diagnostics/recordsWindow";

// The buffer was fetched an hour ago for the 24 hours before that.
const loaded = {
  startDate: "2025-03-07T10:00:00.000Z",
  endDate: "2025-03-08T10:00:00.000Z",
};
const now = "2025-03-08T11:00:00.000Z";

describe("windowIsWithinLoaded", () => {
  it("accepts a shorter lookback whose end has rolled past the buffer", () => {
    expect(
      windowIsWithinLoaded(
        { startDate: "2025-03-08T05:00:00.000Z", endDate: now },
        loaded,
        { allowStaleEnd: true },
      ),
    ).toBe(true);
  });

  it("rejects a longer lookback, which needs rows the buffer never held", () => {
    expect(
      windowIsWithinLoaded(
        { startDate: "2025-03-01T11:00:00.000Z", endDate: now },
        loaded,
      ),
    ).toBe(false);
  });

  it("rejects a window starting after the data ends", () => {
    // "Last 10 minutes" against an hour-old buffer would otherwise show an
    // empty table for a window the warehouse would have filled.
    expect(
      windowIsWithinLoaded(
        { startDate: "2025-03-08T10:50:00.000Z", endDate: now },
        loaded,
      ),
    ).toBe(false);
  });

  it("accepts a fixed window fully inside the buffer", () => {
    expect(
      windowIsWithinLoaded(
        {
          startDate: "2025-03-07T12:00:00.000Z",
          endDate: "2025-03-07T18:00:00.000Z",
        },
        loaded,
      ),
    ).toBe(true);
  });

  it("rejects a fixed window whose end extends past the buffer", () => {
    expect(
      windowIsWithinLoaded(
        {
          startDate: "2025-03-07T12:00:00.000Z",
          endDate: "2025-03-08T11:00:00.000Z",
        },
        loaded,
      ),
    ).toBe(false);
  });

  it("rejects an unparseable window rather than guessing", () => {
    expect(
      windowIsWithinLoaded({ startDate: "nonsense", endDate: now }, loaded),
    ).toBe(false);
  });
});

describe("rowsWithinWindow", () => {
  type Row = { at: string | null };
  const getTimestamp = (row: Row) => row.at;
  const window = {
    startDate: "2025-03-08T05:00:00.000Z",
    endDate: "2025-03-08T11:00:00.000Z",
  };

  it("keeps only the rows inside the window, inclusive of both edges", () => {
    const rows: Row[] = [
      { at: "2025-03-08T04:59:59.999Z" },
      { at: "2025-03-08T05:00:00.000Z" },
      { at: "2025-03-08T08:00:00.000Z" },
      { at: "2025-03-08T11:00:00.000Z" },
      { at: "2025-03-08T11:00:00.001Z" },
    ];
    expect(rowsWithinWindow(rows, window, getTimestamp)).toEqual([
      { at: "2025-03-08T05:00:00.000Z" },
      { at: "2025-03-08T08:00:00.000Z" },
      { at: "2025-03-08T11:00:00.000Z" },
    ]);
  });

  it("keeps a row whose timestamp cannot be read", () => {
    const rows: Row[] = [{ at: null }, { at: "not a date" }];
    expect(rowsWithinWindow(rows, window, getTimestamp)).toEqual(rows);
  });

  it("returns every row when the window itself is unusable", () => {
    const rows: Row[] = [{ at: "2025-03-01T00:00:00.000Z" }];
    expect(
      rowsWithinWindow(
        rows,
        { startDate: "nonsense", endDate: "nonsense" },
        getTimestamp,
      ),
    ).toEqual(rows);
  });
});
