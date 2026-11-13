import { NULL_DIMENSION_VALUE } from "shared/constants";
import type { DimensionInterface } from "shared/types/dimension";
import {
  athenaDialect,
  bigQueryDialect,
  postgresDialect,
  prestoDialect,
} from "shared/dialects";
import {
  getTimedUnitDimensionCondition,
  getTimedUnitDimensionValue,
} from "back-end/src/integrations/sql/fact-metrics/timed-unit-dimension-value";

const base: DimensionInterface = {
  id: "dim_1",
  organization: "org",
  owner: "",
  datasource: "ds",
  userIdType: "user_id",
  name: "Plan",
  sql: "SELECT user_id, plan AS value, ts AS timestamp FROM plans",
  dateCreated: null,
  dateUpdated: null,
};

describe("getTimedUnitDimensionCondition", () => {
  it("compares the row timestamp against first exposure", () => {
    expect(
      getTimedUnitDimensionCondition(
        { ...base, timing: "rowTimestamp" },
        "u.first_exposure_timestamp",
        "d",
      ),
    ).toBe("d.matched = 1 AND d.timestamp <= u.first_exposure_timestamp");
  });

  it("checks the validity range with an open-ended NULL end", () => {
    expect(
      getTimedUnitDimensionCondition(
        { ...base, timing: "validityRange" },
        "u.first_exposure_timestamp",
        "d",
      ),
    ).toBe(
      "d.matched = 1 AND d.start_timestamp <= u.first_exposure_timestamp AND (d.end_timestamp IS NULL OR u.first_exposure_timestamp < d.end_timestamp)",
    );
  });

  it("rejects static dimensions", () => {
    expect(() =>
      getTimedUnitDimensionCondition(base, "u.first_exposure_timestamp", "d"),
    ).toThrow();
  });
});

describe("getTimedUnitDimensionValue", () => {
  it("keeps the time check inside the aggregate and falls back to the null dimension", () => {
    const sql = getTimedUnitDimensionValue(
      postgresDialect,
      { ...base, timing: "validityRange" },
      "u.first_exposure_timestamp",
      "__dim_unit_dim_1",
    );
    const flat = sql.replace(/\s+/g, " ");
    expect(flat).toMatch(/^COALESCE\( SUBSTRING\( MAX\(/);
    expect(flat).toContain(
      "__dim_unit_dim_1.start_timestamp <= u.first_exposure_timestamp",
    );
    expect(flat).toContain("__dim_unit_dim_1.end_timestamp IS NULL");
    // NULL values are labeled per row so the latest row still wins the MAX
    expect(flat).toContain(
      `COALESCE(${postgresDialect.castToString("__dim_unit_dim_1.value")}, '${NULL_DIMENSION_VALUE}')`,
    );
    expect(flat).toContain("20, 99999");
    expect(flat).toContain(`'${NULL_DIMENSION_VALUE}'`);
    expect(flat).not.toContain("JOIN");
  });

  it("substitutes an escaped null label for the default sentinel", () => {
    const sql = getTimedUnitDimensionValue(
      postgresDialect,
      { ...base, timing: "rowTimestamp", nullLabel: "Didn't sign up" },
      "u.first_exposure_timestamp",
      "d",
    );
    expect(sql).toContain("'Didn''t sign up'");
    expect(sql).not.toContain(NULL_DIMENSION_VALUE);
  });

  it("orders rowTimestamp rows by the timestamp column", () => {
    const sql = getTimedUnitDimensionValue(
      postgresDialect,
      { ...base, timing: "rowTimestamp" },
      "e.first_exposure_timestamp",
      "d",
    );
    expect(sql).toContain(postgresDialect.formatDateTimeString("d.timestamp"));
    expect(sql).toContain("d.timestamp <= e.first_exposure_timestamp");
    expect(sql).not.toContain("start_timestamp");
  });

  // to_iso8601 on a DATE column is 10 chars; without padding, stripping the
  // 19-char prefix would cut the first 9 characters off the value
  it.each([
    { name: "athena", dialect: athenaDialect },
    { name: "presto", dialect: prestoDialect },
  ])("pads the timestamp prefix to a fixed width on $name", ({ dialect }) => {
    const flat = getTimedUnitDimensionValue(
      dialect,
      { ...base, timing: "rowTimestamp" },
      "u.first_exposure_timestamp",
      "d",
    ).replace(/\s+/g, " ");
    expect(flat).toContain(
      `SUBSTRING(CONCAT(to_iso8601(d.timestamp), '${"0".repeat(19)}'), 1, 19)`,
    );
    expect(flat).toContain("), 20, 99999");
  });

  it("uses the exposure expression verbatim so callers can cast stored timestamps", () => {
    const exposure = bigQueryDialect.castUserDateCol(
      "e.first_exposure_timestamp",
    );
    const sql = getTimedUnitDimensionValue(
      bigQueryDialect,
      { ...base, timing: "validityRange" },
      exposure,
      "d",
    );
    expect(sql).toContain(`d.start_timestamp <= ${exposure}`);
    expect(sql).toContain(`${exposure} < d.end_timestamp`);
  });
});
