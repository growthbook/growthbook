import { ColumnInterface } from "shared/types/fact-table";
import {
  getColumnEligibility,
  getColumnRole,
  getSecondaryFilterColumnOptions,
  prepareColumnUpdate,
  toConditionalInlineFilters,
} from "@/services/columnEditModel";

const column = (c: Partial<ColumnInterface>) =>
  ({
    column: "country",
    datatype: "string",
    deleted: false,
    ...c,
  }) as ColumnInterface;

// The user_id identifier type points at a column named `uid`
const factTable = (columns: ColumnInterface[]) => ({
  userIdTypes: ["user_id"],
  userIdColumns: { user_id: "uid" },
  timestampColumn: "event_time",
  columns,
});

describe("getColumnRole", () => {
  it("reads roles from the mappings, not column names", () => {
    const table = factTable([]);
    expect(getColumnRole(table, "uid")).toBe("identifier");
    expect(getColumnRole(table, "user_id")).toBe(null);
    expect(getColumnRole(table, "event_time")).toBe("timestamp");
    expect(getColumnRole(table, "timestamp")).toBe(null);
  });
});

describe("getColumnEligibility", () => {
  it("never offers filtering or Auto Slice on a mapped column", () => {
    const uid = column({ column: "uid" });
    expect(getColumnEligibility(factTable([uid]), uid)).toEqual({
      canFilter: false,
      canAutoSlice: false,
    });
  });

  it("judges a column that isn't saved yet", () => {
    expect(getColumnEligibility(factTable([]), column({}))).toEqual({
      canFilter: true,
      canAutoSlice: true,
    });
    expect(
      getColumnEligibility(factTable([]), column({ datatype: "number" })),
    ).toEqual({ canFilter: false, canAutoSlice: false });
  });
});

describe("prepareColumnUpdate", () => {
  it("keeps the saved display name unless the edit changes it", () => {
    const country = column({ name: "Country" });
    const table = factTable([country]);
    expect(
      prepareColumnUpdate(table, country, { description: "x" }).data.name,
    ).toBe("Country");
    expect(
      prepareColumnUpdate(table, country, { name: "Nation" }).data.name,
    ).toBe("Nation");
  });

  it("clears value mappings when filtering is turned off", () => {
    const country = column({ alwaysInlineFilter: true });
    expect(
      prepareColumnUpdate(factTable([country]), country, {
        alwaysInlineFilter: false,
      }).data,
    ).toEqual({ alwaysInlineFilter: false, conditionalInlineFilters: {} });
  });

  it("drops filtering and Auto Slice on an identifier", () => {
    const uid = column({ column: "uid" });
    expect(
      prepareColumnUpdate(factTable([uid]), uid, {
        alwaysInlineFilter: true,
        isAutoSliceColumn: true,
      }),
    ).toEqual({
      data: {
        alwaysInlineFilter: false,
        conditionalInlineFilters: {},
        isAutoSliceColumn: false,
      },
      loadTopValues: false,
    });
  });

  it("loads top values only for a new string Auto Slice without levels", () => {
    const country = column({});
    const flag = column({ column: "flag", datatype: "boolean" });
    const table = factTable([country, flag]);
    expect(
      prepareColumnUpdate(table, country, { isAutoSliceColumn: true })
        .loadTopValues,
    ).toBe(true);
    expect(
      prepareColumnUpdate(table, country, {
        isAutoSliceColumn: true,
        autoSlices: ["US"],
      }).loadTopValues,
    ).toBe(false);
    const boolean = prepareColumnUpdate(table, flag, {
      isAutoSliceColumn: true,
      autoSlices: [],
    });
    expect(boolean.loadTopValues).toBe(false);
    expect(boolean.data.autoSlices).toEqual(["true", "false"]);
  });
});

describe("toConditionalInlineFilters", () => {
  it("keeps only complete mappings", () => {
    expect(
      toConditionalInlineFilters([
        { value: "purchase", column: "currency" },
        { value: "view", column: "" },
        { value: "", column: "page" },
      ]),
    ).toEqual({ purchase: "currency" });
  });
});

describe("getSecondaryFilterColumnOptions", () => {
  it("offers other filterable columns and string JSON fields", () => {
    const table = factTable([
      column({ column: "event" }),
      column({ column: "country", name: "Country" }),
      column({ column: "uid" }),
      column({ column: "amount", datatype: "number" }),
      column({ column: "old", deleted: true }),
      column({
        column: "props",
        datatype: "json",
        jsonFields: {
          plan: { datatype: "string" },
          price: { datatype: "number" },
        },
      }),
    ]);
    expect(getSecondaryFilterColumnOptions(table, "event")).toEqual([
      { label: "Country", value: "country" },
      { label: "props.plan", value: "props.plan" },
    ]);
  });
});
