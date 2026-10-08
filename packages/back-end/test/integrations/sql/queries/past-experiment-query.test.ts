import type { ExposureQuery } from "shared/types/datasource";
import { postgresDialect } from "shared/dialects";
import { getPastExperimentQuery } from "back-end/src/integrations/sql/queries/past-experiment-query";

describe("getPastExperimentQuery", () => {
  it("counts units on a declared identifier once the legacy one was removed", () => {
    const query: ExposureQuery = {
      id: "exq_1",
      name: "Assignments",
      userIdType: "anonymous_id",
      userIdTypes: ["user_id"],
      query: "SELECT user_id, timestamp, experiment_id, variation_id FROM t",
      dimensions: [],
    };

    const sql = getPastExperimentQuery(
      postgresDialect,
      [query],
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-02-01T00:00:00Z"),
    );

    expect(sql).toContain("COUNT(distinct user_id)");
    expect(sql).not.toContain("anonymous_id");
  });
});
