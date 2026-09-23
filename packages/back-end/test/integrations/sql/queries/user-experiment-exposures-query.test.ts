import type { DataSourceInterface } from "shared/types/datasource";
import { getUserExperimentExposuresQuery } from "back-end/src/integrations/sql/queries/user-experiment-exposures-query";
import { postgresDialect } from "back-end/src/integrations/dialects/postgres";

const datasource = {
  settings: {
    queries: {
      exposure: [
        {
          id: "eq_multi",
          userIdType: "anonymous_id",
          userIdTypes: ["anonymous_id", "user_id"],
          query: "SELECT * FROM multi_exposures",
          dimensions: [],
        },
        {
          id: "eq_anon",
          userIdType: "anonymous_id",
          userIdTypes: ["anonymous_id"],
          query: "SELECT * FROM anon_exposures",
          dimensions: [],
        },
      ],
    },
  },
} as unknown as DataSourceInterface;

describe("getUserExperimentExposuresQuery", () => {
  it("includes queries that declare the identifier beyond their first and filters on it", () => {
    const sql = getUserExperimentExposuresQuery(postgresDialect, datasource, {
      unitId: "u_123",
      userIdType: "user_id",
      lookbackDays: 7,
    });
    expect(sql).toContain("multi_exposures");
    expect(sql).not.toContain("anon_exposures");
    expect(sql).toContain(
      `${postgresDialect.castToString("user_id")} = 'u_123'`,
    );
    expect(sql).not.toContain(postgresDialect.castToString("anonymous_id"));
  });
});
