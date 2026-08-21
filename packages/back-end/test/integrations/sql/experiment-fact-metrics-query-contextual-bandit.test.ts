import type { DataSourceInterface } from "shared/types/datasource";
import { buildUnitsQuerySettingsFromSnapshot } from "shared/util";
import { postgresDialect } from "back-end/src/integrations/dialects/postgres";
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
  "SELECT user_id, timestamp, experiment_id, variation_id, leaf_id, bandit_version, variation_weights FROM cb_assignments";
const nonBanditExposureQuery =
  "SELECT user_id, timestamp, experiment_id, variation_id FROM assignments";

function buildSql({
  contextualBandit,
  query,
}: {
  contextualBandit: boolean;
  query: string;
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
    ...(contextualBandit ? { banditSettings: { contextualBandit: true } } : {}),
  };

  return getExperimentFactMetricsQuery(postgresDialect, datasource, {
    settings: settings as never,
    unitsSource: "exposureQuery",
    unitsSettings: buildUnitsQuerySettingsFromSnapshot(settings as never, {
      query,
      userIdType: "user_id",
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

describe("getExperimentFactMetricsQuery contextual bandit bandit_version join", () => {
  it("joins metric outcomes to exposures by (user, bandit_version) with a version window", () => {
    const c = compact(
      buildSql({ contextualBandit: true, query: cbExposureQuery }),
    );

    // bandit_version is carried through the pipeline
    expect(c).toContain("bandit_version");
    expect(c).toContain("d.bandit_versionASbandit_version");

    // The active window end is the next version's first exposure for the user
    expect(c).toContain("version_window_end");
    expect(c).toContain(
      compact(
        "LEAD(first_exposure_timestamp) OVER ( PARTITION BY user_id ORDER BY first_exposure_timestamp, bandit_version )",
      ),
    );

    // The metric join is clipped at the version window end
    expect(c).toContain(
      compact(
        "AND (d.version_window_end IS NULL OR m.timestamp < d.version_window_end)",
      ),
    );

    // Per-user aggregation is keyed by bandit_version so versions stay distinct
    expect(c).toContain("umj.bandit_version");
  });

  it("does not split by version for a contextual bandit without a bandit_version column", () => {
    const c = compact(
      buildSql({ contextualBandit: true, query: nonBanditExposureQuery }),
    );

    expect(c).not.toContain("version_window_end");
    expect(c).not.toContain("d.bandit_versionASbandit_version");
  });

  it("does not split by version for a standard (non-bandit) experiment", () => {
    const c = compact(
      buildSql({ contextualBandit: false, query: cbExposureQuery }),
    );

    expect(c).not.toContain("version_window_end");
    expect(c).not.toContain("d.bandit_versionASbandit_version");
  });
});
