import type { DataSourceInterface } from "shared/types/datasource";
import { buildUnitsQuerySettingsFromSnapshot } from "shared/util";
import { postgresDialect } from "shared/dialects";
import { getExperimentFactMetricsQuery } from "back-end/src/integrations/sql/queries/experiment-fact-metrics-query";
import { factMetricFactory } from "../../factories/FactMetric.factory";
import { factTableFactory } from "../../factories/FactTable.factory";

const datasource = {
  settings: {},
} as unknown as DataSourceInterface;

const ordersFactTable = factTableFactory.build({
  id: "orders",
  name: "Orders Fact Table",
  sql: "*",
});
const factTableMap = new Map([[ordersFactTable.id, ordersFactTable]]);

const metric = factMetricFactory.build({
  id: "fact_cb",
  metricType: "mean",
  numerator: {
    factTableId: "orders",
    column: "amount",
    aggregation: "sum",
  },
});

const cbExposureQuery =
  "SELECT user_id, timestamp, experiment_id, variation_id, country, leaf_id, bandit_version, variation_weights FROM cb_assignments";
const nonBanditExposureQuery =
  "SELECT user_id, timestamp, experiment_id, variation_id FROM assignments";

function buildSql({
  contextualBandit,
  query,
  periodWeighting = false,
  targetingAttributeColumns = ["country"],
}: {
  contextualBandit: boolean;
  query: string;
  periodWeighting?: boolean;
  targetingAttributeColumns?: string[];
}): string {
  const settings = {
    manual: false,
    dimensions: [],
    metricSettings: [],
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    activationMetric: null,
    defaultMetricPriorSettings: {
      override: false,
      proper: false,
      mean: 0,
      stddev: 0,
    },
    regressionAdjustmentEnabled: false,
    attributionModel: "firstExposure" as const,
    experimentId: "exp_1",
    queryFilter: "",
    segment: "",
    skipPartialData: false,
    datasourceId: "",
    exposureQueryId: "",
    startDate: new Date("2025-01-01"),
    endDate: new Date("2025-01-31"),
    variations: [
      { id: "0", weight: 0.5 },
      { id: "1", weight: 0.5 },
    ],
    ...(contextualBandit
      ? {
          banditSettings: {
            contextualBandit: true,
            targetingAttributeColumns,
            ...(periodWeighting ? { periodWeighting: true } : {}),
          },
        }
      : {}),
  };

  return getExperimentFactMetricsQuery(postgresDialect, datasource, {
    settings: settings as never,
    unitsSource: "exposureQuery",
    unitsSettings: buildUnitsQuerySettingsFromSnapshot(settings as never, {
      query,
      identifierType: "user_id",
    }),
    activationMetric: null,
    dimensions: [],
    segment: null,
    metrics: [metric],
    factTableMap,
    unitsTableFullName: "",
  } as never);
}

function compact(sql: string): string {
  return sql.replace(/\s+/g, "");
}

describe("getExperimentFactMetricsQuery contextual bandit first-exposure attribution", () => {
  it("does not split by version for a contextual bandit with a bandit_version column", () => {
    const c = compact(
      buildSql({ contextualBandit: true, query: cbExposureQuery }),
    );

    // Units are one-per-user (first exposure), so the pipeline never carries
    // bandit_version or clips the metric join to a per-version window.
    expect(c).not.toContain("version_window_end");
    expect(c).not.toContain("d.bandit_versionASbandit_version");
    expect(c).not.toContain("umj.bandit_version");
  });

  it("does not split by version for a contextual bandit without a bandit_version column", () => {
    const c = compact(
      buildSql({ contextualBandit: true, query: nonBanditExposureQuery }),
    );

    expect(c).not.toContain("version_window_end");
    expect(c).not.toContain("d.bandit_versionASbandit_version");
    expect(c).not.toContain("umj.bandit_version");
  });

  it("does not split by version for a standard (non-bandit) experiment", () => {
    const c = compact(
      buildSql({ contextualBandit: false, query: cbExposureQuery }),
    );

    expect(c).not.toContain("version_window_end");
    expect(c).not.toContain("d.bandit_versionASbandit_version");
    expect(c).not.toContain("umj.bandit_version");
  });
});

describe("getExperimentFactMetricsQuery contextual bandit period weighting", () => {
  it("period-weights by bandit_version when enabled", () => {
    const c = compact(
      buildSql({
        contextualBandit: true,
        query: cbExposureQuery,
        periodWeighting: true,
      }),
    );

    // Per-unit first-exposure bandit_version is captured and used as the period.
    expect(c).toContain("__cb_bandit_version");
    expect(c).toContain("__cb_bandit_versionASbandit_period");
    // The shared period-folding CTE is emitted.
    expect(c).toContain("__banditPeriodStatistics");
    expect(c).toContain("__banditPeriodWeights");
    // Single-user periods fall back to the arm's pooled variance (rather than
    // contributing zero variance and hiding uncertainty).
    expect(c).toContain("__variationPooledStats");
    expect(c).toContain("pooled_main_variance/bps.users");
    // Eligible-but-locally-missing periods are imputed at the variation's
    // context-specific mean (their combined weight is 1 - SUM(renormalized
    // weight)), rather than treated as zero conversions.
    expect(c).toContain("/NULLIF(SUM(bps.users),0)*(1-SUM(");
    // Those same missing periods also contribute an imputed (pooled) variance
    // weighted by their renormalized squared-weight mass, so sum_squares is not
    // understated. The squared-weight total is carried on the weight-totals CTE
    // and the imputed term multiplies the arm's pooled variance.
    expect(c).toContain("SUM(POWER(bpw.weight,2))ASvariation_weight_sq_total");
    expect(c).toContain(
      "MAX(vps.m0_pooled_main_variance)*(MAX(vwt.variation_weight_sq_total)",
    );
    // Context attribute remains a real dimension column (no dummy 'All').
    expect(c).toContain("attr_cb_country");
    expect(c).not.toContain("'All'ASdimension");
  });

  it("does not period-weight when the toggle is off", () => {
    const c = compact(
      buildSql({
        contextualBandit: true,
        query: cbExposureQuery,
        periodWeighting: false,
      }),
    );

    expect(c).not.toContain("__cb_bandit_version");
    expect(c).not.toContain("__banditPeriodWeights");
    expect(c).toContain("attr_cb_country");
  });
});
