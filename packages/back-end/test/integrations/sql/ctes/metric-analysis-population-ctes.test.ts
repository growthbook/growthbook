import type { MetricAnalysisSettings } from "shared/types/metric-analysis";
import type { ResolvedExposureQuery } from "shared/types/integrations";
import { postgresDialect } from "shared/dialects";
import { getMetricAnalysisPopulationCTEs } from "back-end/src/integrations/sql/ctes/metric-analysis-population-ctes";

const settings: MetricAnalysisSettings = {
  userIdType: "user_id",
  startDate: new Date("2026-01-01T00:00:00Z"),
  endDate: new Date("2026-02-01T00:00:00Z"),
  lookbackDays: 30,
  populationType: "exposureQuery",
  populationId: "exq_1",
};

const populationExposureQuery: ResolvedExposureQuery = {
  query: "SELECT * FROM exposures",
  identifierType: "user_id",
  columnMapping: {
    userIdColumns: { user_id: "user" },
    timestampColumn: "received_at",
  },
};

function buildSql(exposureQuery: ResolvedExposureQuery) {
  return getMetricAnalysisPopulationCTEs(postgresDialect, {
    populationExposureQuery: exposureQuery,
    settings,
    idJoinMap: {},
    factTableMap: new Map(),
    segment: null,
  });
}

describe("getMetricAnalysisPopulationCTEs", () => {
  // Unqualified, Postgres reads `user` as CURRENT_USER: a one-unit population
  it("qualifies mapped columns so reserved words stay column references", () => {
    const sql = buildSql(populationExposureQuery);
    expect(sql).toMatch(/SELECT DISTINCT\s+e\.user as user_id/);
    expect(sql).toMatch(/FROM\s+__rawExperiment e/);
    expect(sql).toMatch(/e\.received_at >= /);
    expect(sql).toMatch(/AND e\.received_at <= /);
  });
});
