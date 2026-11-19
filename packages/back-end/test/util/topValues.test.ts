import { ColumnInterface } from "shared/types/fact-table";
import {
  buildTopValuesWrite,
  getTopValueFields,
  keepStoredTopValues,
  populateAutoSlices,
  refillAutoSlices,
  storedTopValuesFilter,
  toStoredColumn,
  withDerivedTopValues,
} from "back-end/src/util/topValues";

describe("getTopValueFields", () => {
  const refreshedAt = new Date("2026-11-01T00:00:00Z");

  it("stores one list, leaving off the counts a query didn't return", () => {
    expect(
      getTopValueFields({
        values: [
          { value: "a", count: 3 },
          { value: "b", count: undefined },
        ],
        refreshedAt,
      }),
    ).toEqual({
      topValueCounts: [{ value: "a", count: 3 }, { value: "b" }],
      topValuesDate: refreshedAt,
    });
  });
});

describe("withDerivedTopValues", () => {
  it("reads topValues from the stored list, never the other way", () => {
    expect(
      withDerivedTopValues({
        column: "country",
        topValues: ["stale"],
        topValueCounts: [{ value: "US", count: 4 }, { value: "CA" }],
      } as ColumnInterface),
    ).toMatchObject({
      topValues: ["US", "CA"],
      topValueCounts: [{ value: "US", count: 4 }, { value: "CA" }],
    });
  });

  it("reads a column saved before counts existed", () => {
    expect(
      withDerivedTopValues({
        column: "country",
        topValues: ["US"],
      } as ColumnInterface),
    ).toMatchObject({ topValues: ["US"], topValueCounts: [{ value: "US" }] });
  });

  it("gives a column without top values an empty list and no counts", () => {
    const column = withDerivedTopValues({ column: "c" } as ColumnInterface);
    expect(column.topValues).toEqual([]);
    expect(column.topValueCounts).toBeUndefined();
  });

  it("is never stored", () => {
    expect(
      toStoredColumn({ column: "c", topValues: ["US"], topValueCounts: [] }),
    ).toEqual({ column: "c", topValueCounts: [] });
  });
});

describe("keepStoredTopValues", () => {
  it("keeps each stored column's top values on a whole-column save", () => {
    const topValuesDate = new Date("2026-11-01T00:00:00Z");
    const stored = [
      {
        column: "country",
        topValues: ["US"],
        topValueCounts: [{ value: "US", count: 4 }],
        topValuesDate,
      } as ColumnInterface,
    ];
    expect(
      keepStoredTopValues(stored, [
        { column: "country", name: "Country", topValues: ["stale"] },
        { column: "plan", topValues: ["stale"], topValuesDate },
      ]),
    ).toEqual([
      {
        column: "country",
        name: "Country",
        topValues: ["US"],
        topValueCounts: [{ value: "US", count: 4 }],
        topValuesDate,
      },
      { column: "plan" },
    ]);
  });
});

describe("Auto Slice level policies", () => {
  const col = {
    column: "country",
    datatype: "string",
    autoSlices: ["edited"],
    lockedAutoSlices: ["locked"],
  } as ColumnInterface;

  it("fill keeps levels the column already has", () => {
    expect(populateAutoSlices(col, ["US", "CA"], 3)).toEqual(["edited"]);
    expect(
      populateAutoSlices({ ...col, autoSlices: [] }, ["US", "CA"], 3),
    ).toEqual(["US", "CA"]);
  });

  it("refill starts from locked levels, then top values", () => {
    expect(refillAutoSlices(col, ["US", "locked", "CA"], 3)).toEqual([
      "locked",
      "US",
      "CA",
    ]);
  });
});

describe("buildTopValuesWrite", () => {
  const refreshedAt = new Date("2026-11-01T00:00:00Z");
  const snapshot = { values: [{ value: "US" }], refreshedAt };
  const current = {
    userIdTypes: ["user_id"],
    userIdColumns: { user_id: "uid" },
    columns: [
      {
        column: "country",
        datatype: "string",
        deleted: false,
        isAutoSliceColumn: true,
        autoSlices: ["edited"],
      },
      { column: "uid", datatype: "string", deleted: false },
      { column: "gone", datatype: "string", deleted: true },
    ] as ColumnInterface[],
  };

  it("writes only top values fields, positionally, for existing columns", () => {
    expect(
      buildTopValuesWrite(current, [
        { column: "country", snapshot },
        { column: "gone", snapshot },
        { column: "missing", snapshot },
      ]),
    ).toEqual({
      $set: {
        "columns.$[c0].topValueCounts": [{ value: "US" }],
        "columns.$[c0].topValuesDate": refreshedAt,
      },
      $unset: { "columns.$[c0].topValues": "" },
      arrayFilters: [{ "c0.column": "country" }],
      filter: {},
      changed: true,
    });
  });

  it("writes columns a background refresh wouldn't select", () => {
    const write = buildTopValuesWrite(
      {
        ...current,
        columns: [
          { column: "v", datatype: "string", isVirtual: true },
          { column: "n", datatype: "number" },
        ] as ColumnInterface[],
      },
      [
        { column: "v", snapshot },
        { column: "n", snapshot },
      ],
    );
    expect(write?.arrayFilters).toEqual([
      { "c0.column": "v" },
      { "c1.column": "n" },
    ]);
  });

  it("guards rewritten Auto Slice levels on the slice settings they used", () => {
    expect(
      buildTopValuesWrite(current, [
        { column: "country", snapshot, slices: "refill" },
      ])?.filter,
    ).toEqual({
      $and: [
        {
          columns: {
            $elemMatch: {
              column: "country",
              isAutoSliceColumn: true,
              datatype: "string",
              autoSlices: ["edited"],
              lockedAutoSlices: { $in: [[], null] },
            },
          },
        },
      ],
    });
  });

  it("applies the update's Auto Slice policy to the current column", () => {
    const fill = buildTopValuesWrite(current, [
      { column: "country", snapshot, slices: "fill" },
    ]);
    expect(fill?.$set["columns.$[c0].autoSlices"]).toEqual(["edited"]);
  });

  it("keeps the last snapshot when a query returns no values", () => {
    const empty = { values: [], refreshedAt };
    expect(
      buildTopValuesWrite(current, [
        { column: "country", snapshot: empty, slices: "refill" },
        { column: "uid", snapshot },
      ])?.arrayFilters,
    ).toEqual([{ "c1.column": "uid" }]);
    expect(
      buildTopValuesWrite(current, [{ column: "country", snapshot: empty }]),
    ).toBe(null);
  });

  it("marks a refresh that only moved the dates as unchanged", () => {
    const stored = {
      ...current,
      columns: [
        withDerivedTopValues({ ...current.columns[0], topValues: ["US"] }),
      ],
    };
    expect(
      buildTopValuesWrite(stored, [{ column: "country", snapshot }])?.changed,
    ).toBe(false);
    expect(
      buildTopValuesWrite(current, [{ column: "country", snapshot }])?.changed,
    ).toBe(true);
  });

  it("returns null when no column applies", () => {
    expect(buildTopValuesWrite(current, [{ column: "gone", snapshot }])).toBe(
      null,
    );
  });
});

describe("storedTopValuesFilter", () => {
  it("matches each stored column's snapshot date, or its absence", () => {
    const topValuesDate = new Date("2026-11-01T00:00:00Z");
    expect(
      storedTopValuesFilter([
        { column: "country", topValuesDate } as ColumnInterface,
        { column: "plan" } as ColumnInterface,
      ]),
    ).toEqual({
      $and: [
        { columns: { $elemMatch: { column: "country", topValuesDate } } },
        { columns: { $elemMatch: { column: "plan", topValuesDate: null } } },
      ],
    });
    expect(storedTopValuesFilter([])).toEqual({});
  });
});
