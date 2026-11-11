import { putDataSourceSettingsBody } from "../../src/validators/data-sources";

const query = {
  id: "eq_a",
  name: "Anonymous",
  identifierTypes: ["anonymous_id"],
  sql: "SELECT * FROM exposures",
};

describe("putDataSourceSettingsBody", () => {
  it("accepts a column mapping of known roles", () => {
    const result = putDataSourceSettingsBody.safeParse({
      assignmentQueries: [
        {
          ...query,
          columnMapping: {
            timestampColumn: "ts",
            userIdColumns: { anonymous_id: "anon" },
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown column mapping key instead of dropping it", () => {
    const result = putDataSourceSettingsBody.safeParse({
      assignmentQueries: [
        { ...query, columnMapping: { timestampColum: "ts" } },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown query key", () => {
    const result = putDataSourceSettingsBody.safeParse({
      assignmentQueries: [{ ...query, dimensions: [] }],
    });
    expect(result.success).toBe(false);
  });
});
