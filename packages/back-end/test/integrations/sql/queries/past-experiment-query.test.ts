import type { ExposureQuery } from "shared/types/datasource";
import { postgresDialect } from "shared/dialects";
import { getPastExperimentQuery } from "back-end/src/integrations/sql/queries/past-experiment-query";

describe("getPastExperimentQuery", () => {
  it("counts each identifier separately, in one scan of the query", () => {
    const query: ExposureQuery = {
      id: "exq_1",
      name: "Assignments",
      userIdType: "anonymous_id",
      userIdTypes: ["anonymous_id", "user_id"],
      query:
        "SELECT anonymous_id, user_id, timestamp, experiment_id, variation_id FROM t",
      dimensions: [],
    };

    const sql = getPastExperimentQuery(
      postgresDialect,
      query,
      ["anonymous_id", "user_id"],
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-02-01T00:00:00Z"),
    );

    expect(sql.match(/FROM\s+t\b/g)).toHaveLength(1);
    expect(sql).toMatch(/COUNT\(DISTINCT e\.anonymous_id\) as users_0/);
    expect(sql).toMatch(/COUNT\(DISTINCT e\.user_id\) as users_1/);
    expect(sql).toMatch(/'user_id'\s*AS\s*VARCHAR\) as identifier_type/i);
    // Noise thresholds are per identifier
    expect(sql).toMatch(
      /GROUP BY\s+exposure_query,\s*identifier_type,\s*experiment_id,\s*variation_id/,
    );
    // The row cap is split across identifiers, so one can't crowd out another
    expect(sql).toMatch(/PARTITION BY\s+identifier_type/);
    expect(sql).toMatch(/WHERE\s+rn <= 1500/);
  });

  it("reads mapped name columns when the query has them", () => {
    const sql = getPastExperimentQuery(
      postgresDialect,
      {
        id: "exq_1",
        name: "Assignments",
        userIdType: "user_id",
        userIdTypes: ["user_id"],
        query: "SELECT * FROM t",
        dimensions: [],
        hasNameCol: true,
        columnMapping: {
          experimentNameColumn: "exp_title",
          variationNameColumn: "variant_title",
        },
      },
      ["user_id"],
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-02-01T00:00:00Z"),
    );
    expect(sql).toMatch(/MIN\(e\.exp_title\) as experiment_name/);
    expect(sql).toMatch(/MIN\(e\.variant_title\) as variation_name/);
  });

  // Unqualified, Postgres reads `user` as CURRENT_USER and counts one unit
  it("qualifies mapped columns so reserved words stay column references", () => {
    const sql = getPastExperimentQuery(
      postgresDialect,
      {
        id: "exq_1",
        name: "Assignments",
        userIdType: "user_id",
        userIdTypes: ["user_id"],
        query: "SELECT * FROM t",
        dimensions: [],
        columnMapping: {
          userIdColumns: { user_id: "user" },
          timestampColumn: "received_at",
        },
      },
      ["user_id"],
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-02-01T00:00:00Z"),
    );
    expect(sql).toMatch(/COUNT\(DISTINCT e\.user\) as users_0/);
    expect(sql).toMatch(/e\.received_at > /);
    expect(sql).not.toMatch(/[\s(,](user|received_at)\b/);
  });
});
