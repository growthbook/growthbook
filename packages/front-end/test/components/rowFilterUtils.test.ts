import { ColumnInterface, FactTableInterface } from "shared/types/fact-table";
import {
  getAttributeFieldsExposedAsColumns,
  isDateOnlyOperator,
  isDateRangeOperator,
  reshapeDateValueForOperator,
  cleanupDateColumnValues,
  reshapeDateValuesOnOperatorChange,
} from "@/components/FactTables/rowFilterUtils";

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
