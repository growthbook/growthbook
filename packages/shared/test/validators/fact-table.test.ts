import { z } from "zod";
import {
  apiFactTableColumnValidator,
  apiFactTableValidator,
  rowFilterValidator,
  updateFactTablePropsValidator,
  updateFactTableValidator,
} from "../../src/validators/fact-table";
import { postBulkImportFactsValidator } from "../../src/validators/bulk-import";

describe("rowFilterValidator", () => {
  const parse = (operator: string, values?: string[]) =>
    rowFilterValidator.safeParse({ operator, column: "signup_date", values });

  it("accepts a two-bound range", () => {
    expect(parse("between", ["2024-01-01", "2024-02-01"]).success).toBe(true);
    expect(parse("not_between", ["2024-01-01", "2024-02-01"]).success).toBe(
      true,
    );
  });

  it("accepts an open-ended range with a blank bound", () => {
    expect(parse("between", ["2024-01-01", ""]).success).toBe(true);
    expect(parse("between", ["", "2024-02-01"]).success).toBe(true);
  });

  it("accepts a range that has not been filled in yet", () => {
    expect(parse("between", []).success).toBe(true);
    expect(parse("between", undefined).success).toBe(true);
  });

  it("rejects a range with more than two values", () => {
    for (const operator of ["between", "not_between"]) {
      const result = parse(operator, [
        "2024-01-01",
        "2024-02-01",
        "2024-03-01",
      ]);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toStrictEqual(["values"]);
    }
  });

  it("does not restrict value counts for other operators", () => {
    expect(parse("in", ["a", "b", "c"]).success).toBe(true);
  });
});

// The bulk-import body re-declares the row filter shape inline (twice — once per
// column ref), so the range rule has to be wired into each copy rather than
// inherited. Assert through the real body schema so a new copy that forgets it
// fails here instead of silently accepting a three-bound range.
describe("postBulkImportFacts rowFilters", () => {
  const parse = (values: string[]) =>
    postBulkImportFactsValidator.bodySchema.safeParse({
      factMetrics: [
        {
          id: "fact__test",
          data: {
            name: "Test",
            metricType: "mean",
            numerator: {
              factTableId: "ft_1",
              column: "amount",
              rowFilters: [
                { operator: "between", column: "signup_date", values },
              ],
            },
          },
        },
      ],
    });

  it("accepts a two-bound range", () => {
    expect(parse(["2024-01-01", "2024-02-01"]).success).toBe(true);
  });

  it("rejects a range with more than two values", () => {
    const result = parse(["2024-01-01", "2024-02-01", "2024-03-01"]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toContain("values");
  });
});

function isResponseOnly(schema: z.ZodType): boolean {
  if (schema instanceof z.ZodOptional) {
    return isResponseOnly(schema.unwrap());
  }
  return schema instanceof z.ZodReadonly;
}

describe("updateFactTableValidator", () => {
  it("keeps columnsError response-only", () => {
    expect(isResponseOnly(apiFactTableValidator.shape.columnsError)).toBe(true);
  });

  it("rejects the response-only fact table field columnsError", () => {
    const result = updateFactTableValidator.bodySchema.safeParse({
      columnsError: "SQL compilation error",
    });

    expect(result.success).toBe(false);
  });

  it("excludes every response-only column field", () => {
    const updateColumnShape =
      updateFactTableValidator.bodySchema.shape.columns.unwrap().element.shape;
    const responseOnlyFields = Object.entries(apiFactTableColumnValidator.shape)
      .filter(([, schema]) => isResponseOnly(schema))
      .map(([field]) => field);

    expect(responseOnlyFields.length).toBeGreaterThan(0);
    for (const field of responseOnlyFields) {
      expect(updateColumnShape).not.toHaveProperty(field);
    }
  });

  it.each([
    ["dataTypeFromWarehouse", "string"],
    ["dateCreated", "2026-01-01T00:00:00.000Z"],
    ["dateUpdated", "2026-01-01T00:00:00.000Z"],
  ])("rejects the response-only column field %s", (field, value) => {
    const result = updateFactTableValidator.bodySchema.safeParse({
      columns: [
        {
          column: "payload",
          datatype: "json",
          [field]: value,
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});

describe("updateFactTablePropsValidator", () => {
  it("rejects the server-owned field columnsError", () => {
    const result = updateFactTablePropsValidator.safeParse({
      columnsError: "SQL compilation error",
    });

    expect(result.success).toBe(false);
  });
});
