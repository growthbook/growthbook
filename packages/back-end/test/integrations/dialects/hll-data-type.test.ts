import { baseDialect } from "back-end/src/integrations/dialects/base";
import { bigQueryDialect } from "back-end/src/integrations/dialects/bigquery";
import { snowflakeDialect } from "back-end/src/integrations/dialects/snowflake";
import { databricksDialect } from "back-end/src/integrations/dialects/databricks";
import { redshiftDialect } from "back-end/src/integrations/dialects/redshift";
import { castToHllDataType } from "back-end/src/integrations/sql/primitives/cast-to-hll-data-type";

// Dialects supporting HLL count-distinct must override getDataType("hll")
// to match their sketch type, or castToHllDataType() emits invalid SQL.
describe("SqlDialect getDataType('hll') matches each dialect's HLL sketch type", () => {
  const cases: [
    string,
    { getDataType: typeof baseDialect.getDataType },
    string,
  ][] = [
    ["bigquery", bigQueryDialect, "BYTES"],
    ["databricks", databricksDialect, "BINARY"],
    ["snowflake", snowflakeDialect, "BINARY"],
    [
      "redshift (native HLLSKETCH, not VARBINARY)",
      redshiftDialect,
      "HLLSKETCH",
    ],
  ];

  it.each(cases)("%s", (_name, dialect, expected) => {
    expect(dialect.getDataType("hll")).toBe(expected);
  });

  it("redshift: castToHllDataType casts to HLLSKETCH, not VARBINARY", () => {
    expect(castToHllDataType(redshiftDialect, "HLL_CREATE_SKETCH(col)")).toBe(
      "CAST(HLL_CREATE_SKETCH(col) AS HLLSKETCH)",
    );
  });
});
