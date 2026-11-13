import { ReqContext } from "back-end/types/request";
import {
  dateCursorFilter,
  getNextDateCursor,
  parseDateCursor,
} from "back-end/src/util/dateCursor";

const context = {
  throwBadRequestError: (message: string) => {
    throw new Error(message);
  },
} as unknown as ReqContext;

const at = (iso: string) => new Date(iso);

describe("parseDateCursor", () => {
  it("returns null without a value", () => {
    expect(parseDateCursor(context, undefined)).toBeNull();
    expect(parseDateCursor(context, "")).toBeNull();
  });

  it("accepts a plain date-time", () => {
    expect(parseDateCursor(context, "2026-10-01T00:00:00.000Z")).toEqual({
      date: at("2026-10-01T00:00:00.000Z"),
      seen: [],
    });
  });

  it("reads the ids already returned at the boundary", () => {
    expect(
      parseDateCursor(context, "2026-10-01T00:00:00.000Z_aud_1,aud_2"),
    ).toEqual({
      date: at("2026-10-01T00:00:00.000Z"),
      seen: ["aud_1", "aud_2"],
    });
  });

  it("refuses an invalid date", () => {
    expect(() => parseDateCursor(context, "yesterday_aud_1")).toThrow(
      "Invalid cursor",
    );
  });
});

describe("dateCursorFilter", () => {
  it("filters nothing without a cursor", () => {
    expect(dateCursorFilter(null)).toEqual({});
  });

  it("keeps older entries and unseen ones at the boundary", () => {
    const date = at("2026-10-01T00:00:00.000Z");
    expect(dateCursorFilter({ date, seen: [] })).toEqual({
      $or: [{ dateCreated: { $lt: date } }],
    });
    expect(dateCursorFilter({ date, seen: ["aud_1"] })).toEqual({
      $or: [
        { dateCreated: { $lt: date } },
        { dateCreated: date, id: { $nin: ["aud_1"] } },
      ],
    });
  });
});

describe("getNextDateCursor", () => {
  it("ends paging on an empty or short page", () => {
    expect(getNextDateCursor([], 2, null)).toBeNull();
    expect(
      getNextDateCursor([{ id: "a", dateCreated: at("2026-10-01") }], 2, null),
    ).toBeNull();
  });

  it("walks entries that share a timestamp across several pages", () => {
    const tie = at("2026-10-02T00:00:00.000Z");
    // Newest first, as the endpoints sort
    const entries = [
      { id: "e1", dateCreated: at("2026-10-03T00:00:00.000Z") },
      { id: "e2", dateCreated: tie },
      { id: "e3", dateCreated: tie },
      { id: "e4", dateCreated: tie },
      { id: "e5", dateCreated: tie },
      { id: "e6", dateCreated: at("2026-10-01T00:00:00.000Z") },
    ];
    // Applies dateCursorFilter's semantics to the in-memory list
    const pageAfter = (cursor: ReturnType<typeof parseDateCursor>) =>
      entries
        .filter(
          (e) =>
            !cursor ||
            e.dateCreated < cursor.date ||
            (e.dateCreated.getTime() === cursor.date.getTime() &&
              !cursor.seen.includes(e.id)),
        )
        .slice(0, 2);

    const returned: string[] = [];
    let cursor: ReturnType<typeof parseDateCursor> = null;
    for (let i = 0; i < 10; i++) {
      const page = pageAfter(cursor);
      returned.push(...page.map((e) => e.id));
      const next = getNextDateCursor(page, 2, cursor);
      if (!next) break;
      cursor = parseDateCursor(context, next);
    }
    expect(returned).toEqual(["e1", "e2", "e3", "e4", "e5", "e6"]);
  });
});
