import { z } from "zod";
import {
  apiFactTableColumnValidator,
  updateFactTableValidator,
} from "../../src/validators/fact-table";

function isResponseOnly(schema: z.ZodType): boolean {
  if (schema instanceof z.ZodOptional) {
    return isResponseOnly(schema.unwrap());
  }
  return schema instanceof z.ZodReadonly;
}

describe("updateFactTableValidator", () => {
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
