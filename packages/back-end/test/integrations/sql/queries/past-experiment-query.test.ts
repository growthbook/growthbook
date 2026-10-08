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
    expect(sql).toMatch(/COUNT\(distinct anonymous_id\) as users_0/);
    expect(sql).toMatch(/COUNT\(distinct user_id\) as users_1/);
    expect(sql).toMatch(/'user_id'\s*AS\s*VARCHAR\) as identifier_type/i);
    // Noise thresholds are per identifier
    expect(sql).toMatch(
      /GROUP BY\s+exposure_query,\s*identifier_type,\s*experiment_id,\s*variation_id/,
    );
  });
});
