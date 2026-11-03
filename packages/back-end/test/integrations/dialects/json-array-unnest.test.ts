import { athenaDialect, prestoDialect } from "shared/dialects";

describe("SqlDialect.jsonArray on Trino engines", () => {
  it("shares one implementation between Athena and Presto", () => {
    expect(athenaDialect.jsonArray).toBe(prestoDialect.jsonArray);
  });

  it("accepts both a text and a native JSON items column", () => {
    const sql = prestoDialect.jsonArray?.unnest("e.items", "item") ?? "";
    // VARCHAR is probed first: identity for text, and the only branch that
    // fails for a JSON array
    expect(sql.indexOf("try_cast(e.items AS VARCHAR)")).toBeLessThan(
      sql.indexOf("json_format"),
    );
    expect(sql).toContain("json_format(CAST(e.items AS JSON))");
    expect(sql).toContain("AS ARRAY(JSON)");
    expect(sql).toContain("AS item_t(item)");
  });

  it("reads fields off an unnested element as text", () => {
    expect(athenaDialect.jsonArray?.fieldText("item", "itemId")).toBe(
      "json_extract_scalar(item, '$.itemId')",
    );
  });
});
