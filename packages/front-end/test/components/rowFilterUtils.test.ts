import { format } from "date-fns";
import { ColumnInterface, FactTableInterface } from "shared/types/fact-table";
import {
  getAttributeFieldsExposedAsColumns,
  isDateOnlyOperator,
  isDateRangeOperator,
  reshapeDateValueForOperator,
  cleanupDateColumnValues,
  reshapeDateValuesOnOperatorChange,
  hideTimeColumn,
  parseRowFilterDateValue,
  getAllowedOperators,
  getRowFilterColumnChange,
  getRowFilterOperatorChange,
  isRowFilterComplete,
} from "@/components/FactTables/rowFilterUtils";

/** Wall-clock the picker would display for a parsed value. */
const FMT = "yyyy-MM-dd HH:mm";

function col(
  column: string,
  overrides: Partial<ColumnInterface> = {},
): ColumnInterface {
  return {
    column,
    name: column,
    datatype: "string",
    deleted: false,
    ...overrides,
  } as ColumnInterface;
}

function factTable(
  columns: ColumnInterface[],
): Pick<FactTableInterface, "columns"> {
  return { columns };
}

describe("getAttributeFieldsExposedAsColumns", () => {
  it("hides attributes fields that also exist as a top-level column", () => {
    const ft = factTable([
      col("company_id"), // identifier aliased out of attributes
      col("attributes", {
        datatype: "json",
        jsonFields: {
          company_id: { datatype: "string" },
          plan: { datatype: "string" },
        },
      }),
    ]);
    expect(getAttributeFieldsExposedAsColumns(ft)).toEqual(
      new Set(["company_id"]),
    );
  });

  it("returns an empty set when there is no attributes JSON column", () => {
    const ft = factTable([col("user_id"), col("event_name")]);
    expect(getAttributeFieldsExposedAsColumns(ft)).toEqual(new Set());
  });

  it("ignores deleted top-level columns and the attributes column itself", () => {
    const ft = factTable([
      col("plan", { deleted: true }), // deleted -> not a real collision
      col("attributes", {
        datatype: "json",
        jsonFields: {
          plan: { datatype: "string" },
          attributes: { datatype: "string" }, // a field literally named "attributes"
        },
      }),
    ]);
    // `plan` collides only with a deleted column, and the json column shouldn't
    // count itself, so nothing is hidden.
    expect(getAttributeFieldsExposedAsColumns(ft)).toEqual(new Set());
  });
});

describe("isDateOnlyOperator", () => {
  it("treats equality and ranges as day-level", () => {
    expect(isDateOnlyOperator("=")).toBe(true);
    expect(isDateOnlyOperator("between")).toBe(true);
    expect(isDateOnlyOperator("not_between")).toBe(true);
  });

  it("treats ordering operators as datetime", () => {
    for (const op of ["<", "<=", ">", ">="]) {
      expect(isDateOnlyOperator(op)).toBe(false);
    }
  });
});

describe("reshapeDateValueForOperator", () => {
  it("strips the time when switching to a date-only operator", () => {
    // e.g. `>` (2026-07-15T09:30) -> `=` : the equality filter must not carry a
    // time into SQL.
    expect(reshapeDateValueForOperator("2026-07-15T09:30", true)).toBe(
      "2026-07-15",
    );
  });

  it("appends midnight when switching to a datetime operator", () => {
    // e.g. `=` (2026-07-15) -> `>` : give the datetime picker a parseable,
    // day-correct value.
    expect(reshapeDateValueForOperator("2026-07-15", false)).toBe(
      "2026-07-15T00:00",
    );
  });

  it("leaves an already-correct value unchanged", () => {
    expect(reshapeDateValueForOperator("2026-07-15", true)).toBe("2026-07-15");
    expect(reshapeDateValueForOperator("2026-07-15T09:30", false)).toBe(
      "2026-07-15T09:30",
    );
  });

  it("passes empty values through untouched", () => {
    expect(reshapeDateValueForOperator("", true)).toBe("");
    expect(reshapeDateValueForOperator("", false)).toBe("");
  });
});

describe("isDateRangeOperator", () => {
  it("is true only for between / not_between", () => {
    expect(isDateRangeOperator("between")).toBe(true);
    expect(isDateRangeOperator("not_between")).toBe(true);
    for (const op of ["=", "<", "<=", ">", ">="]) {
      expect(isDateRangeOperator(op)).toBe(false);
    }
  });
});

describe("cleanupDateColumnValues", () => {
  it("keeps parseable dates and drops empty/invalid ones", () => {
    expect(
      cleanupDateColumnValues([
        "2026-07-15",
        "",
        "foo",
        "2026-07-15T09:30",
        "2026-01-01 24:00:00",
      ]),
    ).toEqual(["2026-07-15", "2026-07-15T09:30"]);
  });
});

describe("reshapeDateValuesOnOperatorChange", () => {
  it("no-ops for non-date columns", () => {
    expect(
      reshapeDateValuesOnOperatorChange(["2026-07-15"], "=", ">", false),
    ).toEqual(["2026-07-15"]);
  });

  it("no-ops when the operator stays on the same side of the boundary", () => {
    // both date-only
    expect(
      reshapeDateValuesOnOperatorChange(
        ["2026-07-15", "2026-07-20"],
        "between",
        "not_between",
        true,
      ),
    ).toEqual(["2026-07-15", "2026-07-20"]);
    // both datetime
    expect(
      reshapeDateValuesOnOperatorChange(["2026-07-15T09:30"], ">", "<", true),
    ).toEqual(["2026-07-15T09:30"]);
  });

  it("reshapes every value when crossing the date-only/datetime boundary", () => {
    // datetime -> date-only strips the time
    expect(
      reshapeDateValuesOnOperatorChange(["2026-07-15T09:30"], ">", "=", true),
    ).toEqual(["2026-07-15"]);
    // date-only -> datetime appends midnight
    expect(
      reshapeDateValuesOnOperatorChange(
        ["2026-07-15", "2026-07-20"],
        "between",
        ">",
        true,
      ),
    ).toEqual(["2026-07-15T00:00", "2026-07-20T00:00"]);
  });
});

describe("hideTimeColumn", () => {
  it("hides the source's event-time column", () => {
    expect(
      hideTimeColumn({
        column: "timestamp",
        timeColumn: "timestamp",
        selectedColumn: undefined,
      }),
    ).toBe(true);
    expect(
      hideTimeColumn({
        column: "signup_date",
        timeColumn: "timestamp",
        selectedColumn: undefined,
      }),
    ).toBe(false);
  });

  it("keeps the event-time column when a filter already targets it", () => {
    expect(
      hideTimeColumn({
        column: "timestamp",
        timeColumn: "timestamp",
        selectedColumn: "timestamp",
      }),
    ).toBe(false);
  });

  it("hides nothing when the source has no event-time column", () => {
    expect(
      hideTimeColumn({
        column: "timestamp",
        timeColumn: undefined,
        selectedColumn: undefined,
      }),
    ).toBe(false);
    expect(
      hideTimeColumn({
        column: "timestamp",
        timeColumn: "",
        selectedColumn: undefined,
      }),
    ).toBe(false);
  });
});

describe("parseRowFilterDateValue", () => {
  it("round-trips the wall-clock the picker writes", () => {
    expect(format(parseRowFilterDateValue("2026-07-15", true)!, FMT)).toBe(
      "2026-07-15 00:00",
    );
    expect(
      format(parseRowFilterDateValue("2026-07-15T09:30", false)!, FMT),
    ).toBe("2026-07-15 09:30");
  });

  it("reads an API-supplied UTC instant as the same wall-clock", () => {
    // Without normalizing, `new Date(...Z)` is an instant and re-formatting it
    // for the browser would rewrite 14:30 to e.g. 07:30 in UTC-7.
    for (const v of [
      "2026-07-15T14:30:00Z",
      "2026-07-15T14:30:00.000Z",
      "2026-07-15 14:30:00",
    ]) {
      expect(format(parseRowFilterDateValue(v, false)!, FMT)).toBe(
        "2026-07-15 14:30",
      );
    }
  });

  it("keeps the calendar day for a date-only picker, whatever the value carries", () => {
    expect(
      format(parseRowFilterDateValue("2026-07-15T23:30:00Z", true)!, FMT),
    ).toBe("2026-07-15 00:00");
  });

  it("returns undefined for values the SQL layer would reject", () => {
    expect(parseRowFilterDateValue(undefined, false)).toBeUndefined();
    expect(parseRowFilterDateValue("", false)).toBeUndefined();
    expect(parseRowFilterDateValue("foo", false)).toBeUndefined();
    expect(parseRowFilterDateValue("2026-02-30", true)).toBeUndefined();
  });
});

describe("getAllowedOperators", () => {
  it("omits != and is_null for date columns", () => {
    const ops = getAllowedOperators("date");
    expect(ops).toEqual([
      "=",
      "<",
      "<=",
      ">",
      ">=",
      "between",
      "not_between",
      "not_null",
    ]);
  });

  it("keeps is_null for the other datatypes", () => {
    for (const datatype of ["string", "number", "boolean", "json", ""]) {
      expect(getAllowedOperators(datatype)).toContain("is_null");
    }
  });
});

describe("getRowFilterColumnChange", () => {
  it("selects a saved filter in one step", () => {
    expect(
      getRowFilterColumnChange(
        "$$saved_filter:flt_1",
        { operator: "=", column: "country", values: ["US"] },
        "",
      ),
    ).toEqual({ operator: "saved_filter", values: ["flt_1"] });
  });

  it("resets the operator when it doesn't apply to the new datatype", () => {
    expect(
      getRowFilterColumnChange(
        "is_paid",
        { operator: "contains", column: "country", values: ["US"] },
        "boolean",
      ),
    ).toEqual({ operator: "is_true", column: "is_paid", values: [] });
  });

  it("keeps a compatible operator but drops non-numeric values", () => {
    expect(
      getRowFilterColumnChange(
        "revenue",
        { operator: "in", column: "country", values: ["10", "US"] },
        "number",
      ),
    ).toEqual({ operator: "in", column: "revenue", values: ["10"] });
  });

  it("leaves saved_filter behind when switching to a column", () => {
    expect(
      getRowFilterColumnChange(
        "country",
        { operator: "saved_filter", values: ["flt_1"] },
        "string",
      ),
    ).toEqual({ operator: "=", column: "country", values: [] });
  });
});

describe("getRowFilterOperatorChange", () => {
  it("strips empty strings when switching to a multi-value operator", () => {
    expect(
      getRowFilterOperatorChange(
        "in",
        { operator: "=", column: "country", values: ["US", ""] },
        false,
      ),
    ).toEqual({ operator: "in", values: ["US"] });
  });
});

describe("isRowFilterComplete", () => {
  it("requires a non-empty value for sql_expr and saved_filter", () => {
    expect(isRowFilterComplete({ operator: "sql_expr", values: [""] })).toBe(
      false,
    );
    expect(
      isRowFilterComplete({ operator: "sql_expr", values: ["a = 1"] }),
    ).toBe(true);
    expect(
      isRowFilterComplete({ operator: "saved_filter", values: ["flt_1"] }),
    ).toBe(true);
  });

  it("requires only a column for value-less operators", () => {
    expect(isRowFilterComplete({ operator: "is_null", column: "a" })).toBe(
      true,
    );
    expect(isRowFilterComplete({ operator: "is_null" })).toBe(false);
  });

  it("requires both a column and a value otherwise", () => {
    expect(
      isRowFilterComplete({ operator: "=", column: "a", values: [""] }),
    ).toBe(false);
    expect(
      isRowFilterComplete({ operator: "=", column: "", values: ["x"] }),
    ).toBe(false);
    expect(
      isRowFilterComplete({ operator: "=", column: "a", values: ["x"] }),
    ).toBe(true);
  });
});
