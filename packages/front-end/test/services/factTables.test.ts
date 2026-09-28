import { DetectedFactTableColumn } from "shared/types/fact-table";
import { getColumnMappingError } from "@/services/factTables";

const cols = (
  ...datatypes: DetectedFactTableColumn["datatype"][]
): DetectedFactTableColumn[] =>
  datatypes.map((datatype, i) => ({ column: `c${i}`, datatype }));

describe("getColumnMappingError", () => {
  it("accepts a date plus an identifier candidate", () => {
    expect(getColumnMappingError(cols("date", "string"))).toBeNull();
    expect(getColumnMappingError(cols("other", "number"))).toBeNull();
    expect(getColumnMappingError(cols("", ""))).toBeNull();
    expect(
      getColumnMappingError(cols("date", "boolean", "json", "")),
    ).toBeNull();
  });

  it("rejects a query with no timestamp candidate", () => {
    expect(getColumnMappingError(cols("string", "number"))).toMatch(
      /date column/,
    );
  });

  it("rejects a query with no identifier candidate", () => {
    expect(getColumnMappingError(cols("date", "boolean"))).toMatch(
      /identifier/,
    );
  });

  it("rejects a single unknown column serving as both", () => {
    expect(getColumnMappingError(cols(""))).toMatch(/separate/);
  });
});
