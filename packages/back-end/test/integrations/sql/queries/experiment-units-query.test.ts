import type { DataSourceInterface } from "shared/types/datasource";
import type { ResolvedExposureQuery } from "shared/types/integrations";
import { postgresDialect } from "shared/dialects";
import { getExperimentUnitsQuery } from "back-end/src/integrations/sql/queries/experiment-units-query";

const mappedExposureQuery: ResolvedExposureQuery = {
  query: "SELECT * FROM exposures",
  identifierType: "user_id",
  columnMapping: {
    userIdColumns: { user_id: "uid" },
    timestampColumn: "received_at",
    experimentIdColumn: "exp_key",
    variationIdColumn: "variant",
  },
};

function buildSql(exposureQuery: ResolvedExposureQuery) {
  return getExperimentUnitsQuery(
    postgresDialect,
    {
      settings: { userIdTypes: [{ userIdType: "user_id" }] },
    } as unknown as DataSourceInterface,
    {
      unitsSettings: {
        experimentId: "my-exp",
        exposureQuery,
        startDate: new Date("2026-01-01T00:00:00Z"),
        endDate: new Date("2026-02-01T00:00:00Z"),
        skipPartialData: false,
        attributionModel: "firstExposure",
        queryFilter: "",
        variations: [],
        metricSettings: [],
      },
      activationMetric: null,
      factTableMap: new Map(),
      dimensions: [],
      segment: null,
      includeIdJoins: false,
    },
  );
}

describe("getExperimentUnitsQuery", () => {
  it("reads every role from its mapped column", () => {
    const sql = buildSql(mappedExposureQuery);

    expect(sql).toMatch(/e\.uid as user_id/);
    expect(sql).toMatch(/CAST\(e\.variant AS VARCHAR\) as variation/i);
    expect(sql).toMatch(/e\.exp_key = 'my-exp'/);
    expect(sql).toMatch(/e\.received_at >= /);
    // Only the aliased CTEs downstream use the canonical names
    expect(sql).not.toMatch(/e\.(experiment_id|variation_id)\b/);
  });

  it("reads the aliased timestamp once the exposures CTE has renamed it", () => {
    const sql = buildSql(mappedExposureQuery);
    const afterExposures = sql.slice(sql.indexOf("__experimentUnits AS ("));

    expect(afterExposures).toMatch(
      /MIN\(e\.timestamp\) AS first_exposure_timestamp/,
    );
    expect(afterExposures).not.toContain("received_at");
  });
});
