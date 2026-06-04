import {
  ExperimentMetricQueryParams,
  ExperimentMetricQueryResponseRows,
} from "shared/types/integrations";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { DataSourceInterface } from "shared/types/datasource";
import { ExperimentMetricInterface } from "shared/experiments";
import { MetricInterface } from "shared/types/metric";
import { ApiReqContext } from "back-end/types/api";
import { getIntegrationFromDatasourceId } from "back-end/src/services/datasource";
import { getFactMetricGroups } from "back-end/src/services/experimentQueries/experimentQueries";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { expandDenominatorMetrics } from "back-end/src/util/sql";

export type ContextualBanditQueryResult = {
  rows: ExperimentMetricQueryResponseRows;
  durationMs: number;
  sql?: string;
};

export type ContextualBanditMetricQueryPlan = {
  sql: string;
  execute: (sql: string) => Promise<ExperimentMetricQueryResponseRows>;
};

export async function planContextualBanditMetricQuery(
  context: ApiReqContext,
  datasource: DataSourceInterface,
  snapshotSettings: ExperimentSnapshotSettings,
  decisionMetric: ExperimentMetricInterface,
  factTableMap: FactTableMap,
  metricMap: Map<string, ExperimentMetricInterface>,
): Promise<ContextualBanditMetricQueryPlan> {
  const integration = await getIntegrationFromDatasourceId(
    context,
    datasource.id,
  );
  if (!integration.getSnapshotMetricQuery) {
    throw new Error(
      "Datasource integration does not support experiment queries",
    );
  }

  const activationMetric = snapshotSettings.activationMetric
    ? (metricMap.get(snapshotSettings.activationMetric) ?? null)
    : null;

  const { factMetricGroups, legacyMetricSingles } = getFactMetricGroups(
    [decisionMetric],
    snapshotSettings,
    integration,
    context.org,
  );

  if (factMetricGroups.length > 0) {
    const group = factMetricGroups[0];
    if (
      !integration.getExperimentFactMetricsQuery ||
      !integration.runExperimentFactMetricsQuery
    ) {
      throw new Error("Integration does not support fact metric queries");
    }
    const queryParams = {
      activationMetric,
      dimensions: [],
      metrics: group,
      segment: null,
      settings: snapshotSettings,
      unitsSource: "exposureQuery" as const,
      unitsTableFullName: "",
      factTableMap,
    };
    const sql = integration.getExperimentFactMetricsQuery(queryParams);
    return {
      sql,
      execute: async (querySql: string) => {
        const { rows } = await integration.runExperimentFactMetricsQuery!(
          querySql,
          async () => {},
        );
        return rows as ExperimentMetricQueryResponseRows;
      },
    };
  }

  const legacyMetric = legacyMetricSingles[0];
  if (!legacyMetric) {
    throw new Error("No runnable metric query for contextual bandit");
  }

  const denominatorMetrics: MetricInterface[] = [];
  if (legacyMetric.denominator) {
    denominatorMetrics.push(
      ...expandDenominatorMetrics(
        legacyMetric.denominator,
        metricMap as Map<string, MetricInterface>,
      )
        .map((m) => metricMap.get(m) as MetricInterface)
        .filter(Boolean),
    );
  }

  const queryParams: ExperimentMetricQueryParams = {
    activationMetric,
    denominatorMetrics,
    dimensions: [],
    metric: legacyMetric,
    segment: null,
    settings: snapshotSettings,
    unitsSource: "exposureQuery",
    unitsTableFullName: "",
    factTableMap,
  };

  const sql = integration.getSnapshotMetricQuery(queryParams);
  return {
    sql,
    execute: async (querySql: string) => {
      const { rows } = await integration.runSnapshotMetricQuery(
        querySql,
        async () => {},
      );
      return rows;
    },
  };
}

export async function buildContextualBanditMetricQuerySql(
  context: ApiReqContext,
  datasource: DataSourceInterface,
  snapshotSettings: ExperimentSnapshotSettings,
  decisionMetric: ExperimentMetricInterface,
  factTableMap: FactTableMap,
  metricMap: Map<string, ExperimentMetricInterface>,
): Promise<string> {
  const plan = await planContextualBanditMetricQuery(
    context,
    datasource,
    snapshotSettings,
    decisionMetric,
    factTableMap,
    metricMap,
  );
  return plan.sql;
}

export async function executeContextualBanditMetricQuery(
  context: ApiReqContext,
  datasource: DataSourceInterface,
  sql: string,
  snapshotSettings: ExperimentSnapshotSettings,
  decisionMetric: ExperimentMetricInterface,
  factTableMap: FactTableMap,
  metricMap: Map<string, ExperimentMetricInterface>,
): Promise<Omit<ContextualBanditQueryResult, "sql">> {
  const startMs = Date.now();
  const plan = await planContextualBanditMetricQuery(
    context,
    datasource,
    snapshotSettings,
    decisionMetric,
    factTableMap,
    metricMap,
  );
  const rows = await plan.execute(sql);
  return {
    rows,
    durationMs: Date.now() - startMs,
  };
}

export async function runContextualBanditMetricQuery(
  context: ApiReqContext,
  datasource: DataSourceInterface,
  snapshotSettings: ExperimentSnapshotSettings,
  decisionMetric: ExperimentMetricInterface,
  factTableMap: FactTableMap,
  metricMap: Map<string, ExperimentMetricInterface>,
): Promise<ContextualBanditQueryResult> {
  const plan = await planContextualBanditMetricQuery(
    context,
    datasource,
    snapshotSettings,
    decisionMetric,
    factTableMap,
    metricMap,
  );
  const startMs = Date.now();
  const rows = await plan.execute(plan.sql);
  return {
    rows,
    durationMs: Date.now() - startMs,
    sql: plan.sql,
  };
}
