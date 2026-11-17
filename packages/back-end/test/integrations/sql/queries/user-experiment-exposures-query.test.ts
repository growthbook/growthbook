import type { DataSourceInterface } from "shared/types/datasource";
import { postgresDialect } from "shared/dialects";
import { getUserExperimentExposuresQuery } from "back-end/src/integrations/sql/queries/user-experiment-exposures-query";

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
      `${postgresDialect.castToString("t0.user_id")} = 'u_123'`,
    );
    expect(sql).not.toContain(postgresDialect.castToString("t0.anonymous_id"));
  });

  // Unqualified, Postgres reads `user` as CURRENT_USER and matches no rows
  it("qualifies mapped columns so reserved words stay column references", () => {
    const sql = getUserExperimentExposuresQuery(
      postgresDialect,
      {
        settings: {
          queries: {
            exposure: [
              {
                id: "eq_mapped",
                userIdType: "user_id",
                userIdTypes: ["user_id"],
                query: "SELECT * FROM mapped_exposures",
                dimensions: [],
                columnMapping: {
                  userIdColumns: { user_id: "user" },
                  timestampColumn: "received_at",
                  experimentIdColumn: "exp_key",
                  variationIdColumn: "variant",
                },
              },
            ],
          },
        },
      } as unknown as DataSourceInterface,
      { unitId: "u_123", userIdType: "user_id", lookbackDays: 7 },
    );
    expect(sql).toContain(
      `${postgresDialect.castToString("t0.user")} = 'u_123'`,
    );
    expect(sql).toMatch(
      /t0\.received_at as timestamp,\s*t0\.exp_key as experiment_id,\s*t0\.variant as variation_id/,
    );
    expect(sql).toMatch(/AND t0\.received_at >= /);
  });
});
