import { clickHouseDialect } from "shared/dialects";

const compact = (sql: string) => sql.replace(/\s+/g, " ").trim();

describe("clickHouseDialect.jsonExtract", () => {
  it("reads a nested path as one key per level", () => {
    expect(
      compact(
        clickHouseDialect.jsonExtract("props", "address.zip code", false),
      ),
    ).toBe(
      "if( toTypeName(props) = 'JSON', props.address.`zip code`::Nullable(String), JSONExtractString(props, 'address', 'zip code') )",
    );
  });

  it("escapes quotes in string keys", () => {
    expect(
      compact(clickHouseDialect.jsonExtract("props", "o'brien", true)),
    ).toContain("JSONExtractFloat(props, 'o''brien')");
  });
});
