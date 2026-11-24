import { clickHouseDialect } from "shared/dialects";

const compact = (sql: string) => sql.replace(/\s+/g, " ").trim();

describe("clickHouseDialect.jsonExtract", () => {
  it("reads a dotted path as the literal key when present, else nested", () => {
    expect(
      compact(clickHouseDialect.jsonExtract("props", "http.url", false)),
    ).toBe(
      "if( toTypeName(props) = 'JSON', props.`http.url`::Nullable(String), if(JSONHas(props, 'http.url'), JSONExtractString(props, 'http.url'), JSONExtractString(props, 'http', 'url')) )",
    );
  });

  it("keeps an undotted key as a single lookup and escapes quotes", () => {
    expect(
      compact(clickHouseDialect.jsonExtract("props", "o'brien", true)),
    ).toBe(
      "if( toTypeName(props) = 'JSON', toFloat64OrNull(props.`o'brien`::Nullable(String)), JSONExtractFloat(props, 'o''brien') )",
    );
  });
});
