import { ColumnInterface } from "shared/types/fact-table";
import {
  buildTopValuesWrite,
  getTopValueFields,
  keepStoredTopValues,
  populateAutoSlices,
  refillAutoSlices,
  storedTopValuesFilter,
} from "back-end/src/util/topValues";

describe("getTopValueFields", () => {
  const refreshedAt = new Date("2026-11-01T00:00:00Z");

  it("derives the string list from the counts", () => {
    const values = [
      { value: "a", count: 3 },
      { value: "b", count: 1 },
    ];
    expect(getTopValueFields({ values, refreshedAt })).toEqual({
      topValues: ["a", "b"],
      topValueCounts: values,
      topValuesDate: refreshedAt,
    });
  });

  it("stores no counts when any value is missing one", () => {
    expect(
      getTopValueFields({
        values: [{ value: "a" }, { value: "b", count: 2 }],
        refreshedAt,
      }),
    ).toEqual({
      topValues: ["a", "b"],
      topValueCounts: undefined,
      topValuesDate: refreshedAt,
    });
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
        "columns.$[c0].topValues": ["US"],
        "columns.$[c0].topValuesDate": refreshedAt,
      },
      $unset: { "columns.$[c0].topValueCounts": "" },
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
    expect(
      buildTopValuesWrite(current, [
        {
          column: "country",
          snapshot: { values: [], refreshedAt },
          slices: "refill",
        },
      ])?.$set["columns.$[c0].autoSlices"],
    ).toBeUndefined();
  });

  it("marks a refresh that only moved the dates as unchanged", () => {
    const stored = {
      ...current,
      columns: [{ ...current.columns[0], topValues: ["US"] }],
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
