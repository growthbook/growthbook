import { mapColumnTypeToExplorationType } from "shared/enterprise";
import {
  explorationConfigValidator,
  factTableColumnTypes,
} from "shared/validators";
import type { FactTableColumnType } from "shared/types/fact-table";

describe("mapColumnTypeToExplorationType", () => {
  it.each([
    ["string", "string"],
    ["number", "number"],
    ["date", "date"],
    ["boolean", "boolean"],
  ] as const)("keeps %s", (input, expected) => {
    expect(mapColumnTypeToExplorationType(input)).toBe(expected);
  });

  it.each([
    ["json", "other"],
    ["binary", "other"],
    ["other", "other"],
    ["", "other"],
    [undefined, "other"],
  ] as const)("maps %j to other", (input, expected) => {
    expect(mapColumnTypeToExplorationType(input)).toBe(expected);
  });

  it("maps every FactTableColumnType to a value the exploration column-type validator accepts", () => {
    const warehouseTypes: Array<FactTableColumnType | undefined> = [
      ...(factTableColumnTypes as FactTableColumnType[]),
      undefined,
    ];
    const columnTypes = Object.fromEntries(
      warehouseTypes.map((datatype, i) => [
        `col_${i}`,
        mapColumnTypeToExplorationType(datatype),
      ]),
    );

    const parsed = explorationConfigValidator.safeParse({
      type: "sql",
      datasource: "ds1",
      dimensions: [],
      chartType: "rawTable",
      dateRange: { predefined: "last7Days" },
      dataset: {
        type: "sql",
        sql: "SELECT * FROM events",
        timestampColumn: "col_0",
        columnTypes,
        values: [],
      },
    });

    expect(parsed.success).toBe(true);
  });
});
