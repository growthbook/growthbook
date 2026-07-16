import { baseDialect } from "back-end/src/integrations/dialects/base";
import { bigQueryDialect } from "back-end/src/integrations/dialects/bigquery";
import { snowflakeDialect } from "back-end/src/integrations/dialects/snowflake";
import { databricksDialect } from "back-end/src/integrations/dialects/databricks";
import { redshiftDialect } from "back-end/src/integrations/dialects/redshift";
import { castToHllDataType } from "back-end/src/integrations/sql/primitives/cast-to-hll-data-type";

// Every dialect that implements hllAggregate (i.e. supports "count distinct"
// fact metrics) must also override getDataType("hll") to match whatever type
// its HLL functions actually return. If a dialect's HLL sketch type isn't
// castable to the base default of VARBINARY, castToHllDataType() produces
// invalid SQL. See growthbook/growthbook#<issue> — Redshift previously fell
// through to VARBINARY even though HLL_CREATE_SKETCH returns HLLSKETCH,
// which cannot be cast to VARBINARY/VARBYTE and errored with
// "cannot cast type hllsketch to binary varying".
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
