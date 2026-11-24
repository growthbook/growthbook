import { mysqlDialect } from "shared/dialects";

describe("mysqlDialect.jsonExtract", () => {
  it("unquotes string fields so they read as plain text", () => {
    expect(mysqlDialect.jsonExtract("props", "address.country", false)).toBe(
      "JSON_UNQUOTE(JSON_EXTRACT(props, '$.address.country'))",
    );
  });

  it("casts numeric fields without unquoting", () => {
    expect(mysqlDialect.jsonExtract("props", "amount", true)).toBe(
      mysqlDialect.castToFloat("JSON_EXTRACT(props, '$.amount')"),
    );
  });
});
