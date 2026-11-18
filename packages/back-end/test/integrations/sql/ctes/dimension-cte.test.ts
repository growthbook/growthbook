import type { DimensionInterface } from "shared/types/dimension";
import { bigQueryDialect, postgresDialect } from "shared/dialects";
import { getDimensionCTE } from "back-end/src/integrations/sql/ctes/dimension-cte";

const base: DimensionInterface = {
  id: "dim_1",
  organization: "org",
  owner: "",
  datasource: "ds",
  userIdType: "user_id",
  name: "Plan",
  sql: "SELECT user_id, plan AS value FROM plans",
  dateCreated: null,
  dateUpdated: null,
};

const idJoinMap = { user_id: "__identities0" };

describe("getDimensionCTE", () => {
  it("passes static dimension SQL through untouched", () => {
    const sql = getDimensionCTE(base, "user_id", idJoinMap, postgresDialect);
    expect(sql).toContain(base.sql);
    expect(sql).not.toContain("FROM\n        (");
    expect(sql).not.toContain("matched");
  });

  it("wraps rowTimestamp SQL to expose a normalized timestamp column", () => {
    const sql = getDimensionCTE(
      { ...base, timing: "rowTimestamp" },
      "user_id",
      idJoinMap,
      postgresDialect,
    );
    expect(sql).toContain("d.user_id");
    expect(sql).toContain("d.value");
    expect(sql).toContain("d.timestamp AS timestamp");
    expect(sql).not.toContain("start_timestamp");
    // ClickHouse fills an unmatched LEFT JOIN with defaults, not NULLs, so the
    // time check needs a column that is only ever 1 on a real row
    expect(sql).toContain("1 AS matched");
  });

  it("wraps validityRange SQL and casts both range columns", () => {
    const sql = getDimensionCTE(
      { ...base, timing: "validityRange" },
      "user_id",
      idJoinMap,
      bigQueryDialect,
    );
    expect(sql).toContain(
      `${bigQueryDialect.castUserDateCol("d.start_timestamp")} AS start_timestamp`,
    );
    expect(sql).toContain(
      `${bigQueryDialect.castUserDateCol("d.end_timestamp")} AS end_timestamp`,
    );
  });

  it("carries timestamp columns through the identity join", () => {
    const sql = getDimensionCTE(
      { ...base, timing: "validityRange" },
      "anonymous_id",
      idJoinMap,
      postgresDialect,
    );
    expect(sql).toContain("i.anonymous_id");
    expect(sql).toContain("JOIN __identities0 i ON ( i.user_id = d.user_id )");
    expect(sql).toContain("AS start_timestamp");
    expect(sql).toContain("AS end_timestamp");
    expect(sql).toContain("1 AS matched");
  });
});
