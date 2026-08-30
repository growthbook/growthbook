import cloneDeep from "lodash/cloneDeep";
import {
  ExperimentMetricInterface,
  parseSliceMetricId,
} from "shared/experiments";
import type { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import type {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import type { AggregatedFactTableMetricStateInterface } from "shared/validators";

import { precedingUtcDayStart, snapToUtcDayStart } from "shared/dates";
import { ApiReqContext } from "back-end/types/api";
import { applyMetricOverrides } from "back-end/src/util/integration";
import {
  getFactTableSettingsHashForAggregatedFactTable,
  getMetricSettingsHashForAggregatedFactTable,
} from "back-end/src/enterprise/services/data-pipeline";
import { getColumnsForMetric } from "back-end/src/integrations/sql/fact-metrics/columns-for-metric";
import { canReAggregateDailyPartialsForCovariate } from "back-end/src/integrations/sql/fact-metrics/aggregation-metadata";
import { getMetricMinDelay } from "back-end/src/integrations/sql/dates/metric-min-delay";
import { getRaMetricPhaseStartSettings } from "back-end/src/integrations/sql/dates/ra-metric-phase-start-settings";
import { processActivationMetric } from "back-end/src/integrations/sql/processing/process-activation-metric";
import { getMetricRegressionAdjustmentData } from "./metric-data";

export const AGGREGATED_FACT_TABLE_COVARIATE_FRESHNESS_MS = 1000 * 60 * 60 * 36; // 36 hours

export type CovariateInsertPathReason =
  | "aggregated"
  | "no-fact-table"
  | "id-type-not-materialized"
  | "no-materialized-table"
  | "pending-restate"
  | "window-not-covered"
  | "metrics-not-covered"
  | "error";

export type CovariateInsertPath =
  | {
      path: "legacy";
      reason: Exclude<CovariateInsertPathReason, "aggregated">;
    }
  | {
      path: "aggregated";
      aggregatedTableFullName: string;
      idType: string;
      reason: "aggregated";
    };

type ResolveCovariateInsertPathArgs = {
  context: ApiReqContext;
  factTable: FactTableInterface | undefined;
  datasourceId: string;
  exposureUserIdType: string;
  regressionAdjustedMetrics: FactMetricInterface[];
  settings: ExperimentSnapshotSettings;
  activationMetric: ExperimentMetricInterface | null;
};

// Decides whether a fact-table group's covariate insert reads from the
// pre-aggregated daily table or falls back to the legacy raw scan. All-or-nothing
// per group: one covariate INSERT writes a row per unit with every metric column,
// so it can't mix aggregated and raw columns. Any error falls back to legacy
// (always correct) rather than failing the refresh.
export async function resolveCovariateInsertPath(
  args: ResolveCovariateInsertPathArgs,
): Promise<CovariateInsertPath> {
  try {
    return await resolveCovariateInsertPathInner(args);
  } catch (e) {
    args.context.logger.error(
      {
        error: e instanceof Error ? e.message : String(e),
        datasourceId: args.datasourceId,
        exposureUserIdType: args.exposureUserIdType,
        factTableId: args.factTable?.id,
      },
      "[resolveCovariateInsertPath] error resolving path; falling back to legacy",
    );
    return { path: "legacy", reason: "error" };
  }
}

async function resolveCovariateInsertPathInner({
  context,
  factTable,
  datasourceId,
  exposureUserIdType,
  regressionAdjustedMetrics,
  settings,
  activationMetric,
}: ResolveCovariateInsertPathArgs): Promise<CovariateInsertPath> {
  const log = (msg: string, data: Record<string, unknown> = {}) =>
    context.logger.debug(
      { ...data, datasourceId, exposureUserIdType, factTableId: factTable?.id },
      `[resolveCovariateInsertPath] ${msg}`,
    );

  log("resolving covariate insert path", {
    regressionAdjustedMetricIds: regressionAdjustedMetrics.map((m) => m.id),
  });

  if (!factTable) {
    log("legacy: no fact table provided");
    return { path: "legacy", reason: "no-fact-table" };
  }

  const idTypes = factTable.aggregatedFactTableSettings?.idTypes ?? [];
  if (!idTypes.includes(exposureUserIdType)) {
    log("legacy: exposure id type not in aggregatedFactTableSettings.idTypes", {
      aggregatedFactTableIdTypes: idTypes,
    });
    return { path: "legacy", reason: "id-type-not-materialized" };
  }

  const registry = await context.models.aggregatedFactTables.getByKey({
    datasourceId,
    factTableId: factTable.id,
    idType: exposureUserIdType,
  });
  if (!registry || !registry.tableFullName) {
    log("legacy: no registry document or no materialized table", {
      hasRegistry: !!registry,
      tableFullName: registry?.tableFullName ?? null,
    });
    return { path: "legacy", reason: "no-materialized-table" };
  }

  // Same restate triggers the status UI surfaces (incomplete-write / fact-table
  // drift). The next maintenance run will drop and rebuild this table, so until
  // then its data may double-count (a partial prior write) or reflect an older
  // fact-table definition. Per-metric coverage below can't see either, so gate
  // here and fall back to the always-correct legacy scan.
  if ((registry.inFlightExecutionId ?? null) !== null) {
    log("legacy: prior write incomplete, restate pending");
    return { path: "legacy", reason: "pending-restate" };
  }
  if (
    getFactTableSettingsHashForAggregatedFactTable(factTable) !==
    registry.factTableSettingsHash
  ) {
    log("legacy: fact table definition changed, restate pending", {
      registryFactTableSettingsHash: registry.factTableSettingsHash,
    });
    return { path: "legacy", reason: "pending-restate" };
  }

  // Freshness = does the table cover the covariate window (plus a buffer so the
  // last needed day is fully materialized), not wall-clock recency.
  const { firstCovariateDate, lastCovariateDate } = getCovariateWindowBounds(
    regressionAdjustedMetrics,
    settings,
    activationMetric,
  );
  log("computed covariate window bounds", {
    firstCovariateDate,
    lastCovariateDate,
    requiredFirstEventDay: firstCovariateDate
      ? snapToUtcDayStart(firstCovariateDate)
      : null,
    requiredLastEventDay: lastCovariateDate
      ? precedingUtcDayStart(lastCovariateDate)
      : null,
    registryFirstEventDate: registry.firstEventDate ?? null,
    registryLastEventDate: registry.lastEventDate ?? null,
    freshnessBufferMs: AGGREGATED_FACT_TABLE_COVARIATE_FRESHNESS_MS,
  });
  if (
    !firstCovariateDate ||
    !lastCovariateDate ||
    !registry.firstEventDate ||
    !registry.lastEventDate ||
    registry.firstEventDate > snapToUtcDayStart(firstCovariateDate) ||
    registry.lastEventDate.getTime() -
      precedingUtcDayStart(lastCovariateDate).getTime() <
      AGGREGATED_FACT_TABLE_COVARIATE_FRESHNESS_MS
  ) {
    log("legacy: table does not cover the covariate window (with buffer)");
    return { path: "legacy", reason: "window-not-covered" };
  }

  const uncoveredMetricIds = regressionAdjustedMetrics
    .filter(
      (metric) =>
        !isMetricCoveredByRegistry(
          metric,
          factTable.id,
          registry.metricState,
          log,
        ),
    )
    .map((m) => m.id);
  if (uncoveredMetricIds.length > 0) {
    log("legacy: one or more RA metrics not covered by registry", {
      uncoveredMetricIds,
    });
    return { path: "legacy", reason: "metrics-not-covered" };
  }

  log("aggregated: all gates passed", {
    aggregatedTableFullName: registry.tableFullName,
    idType: exposureUserIdType,
  });
  return {
    path: "aggregated",
    aggregatedTableFullName: registry.tableFullName,
    idType: exposureUserIdType,
    reason: "aggregated",
  };
}

// Earliest start / latest end of the covariate window across the group's RA
// metrics, mirroring getMetricData so it matches the window the read uses.
function getCovariateWindowBounds(
  metrics: FactMetricInterface[],
  settings: ExperimentSnapshotSettings,
  rawActivationMetric: ExperimentMetricInterface | null,
): { firstCovariateDate: Date | null; lastCovariateDate: Date | null } {
  const activationMetric = processActivationMetric(
    rawActivationMetric,
    settings,
  );
  let firstCovariateDate: Date | null = null;
  let lastCovariateDate: Date | null = null;
  for (const metric of metrics) {
    const m = cloneDeep(metric);
    applyMetricOverrides(m, settings);
    const { regressionAdjustmentHours } = getMetricRegressionAdjustmentData(
      m,
      settings.regressionAdjustmentEnabled,
    );
    const minDelay = getMetricMinDelay(
      (activationMetric ? [activationMetric] : []).concat([m]),
    );
    const { covariateStartDate, covariateEndDate } =
      getRaMetricPhaseStartSettings({
        minDelay,
        phaseStartDate: settings.startDate,
        regressionAdjustmentHours,
      });
    if (!firstCovariateDate || covariateStartDate < firstCovariateDate)
      firstCovariateDate = covariateStartDate;
    if (!lastCovariateDate || covariateEndDate > lastCovariateDate)
      lastCovariateDate = covariateEndDate;
  }
  return { firstCovariateDate, lastCovariateDate };
}

function isMetricCoveredByRegistry(
  metric: FactMetricInterface,
  factTableId: string,
  metricState: AggregatedFactTableMetricStateInterface[],
  log: (msg: string, data?: Record<string, unknown>) => void = () => {},
): boolean {
  if (!canReAggregateDailyPartialsForCovariate(metric)) {
    log("metric not covered: unsafe to re-aggregate daily partials", {
      metricId: metric.id,
    });
    return false;
  }

  const { baseMetricId, isSliceMetric } = parseSliceMetricId(metric.id);
  const baseState = metricState.find((s) => s.metricId === baseMetricId);
  if (!baseState) {
    log("metric not covered: base metric not in registry metricState", {
      metricId: metric.id,
      baseMetricId,
    });
    return false;
  }

  // Slice clones share the base metric's hash-affecting settings.
  const settingsHash = getMetricSettingsHashForAggregatedFactTable({
    factMetric: metric,
    factTableId,
  });
  if (settingsHash !== baseState.settingsHash) {
    log("metric not covered: settings hash drift", {
      metricId: metric.id,
      computedHash: settingsHash,
      storedHash: baseState.settingsHash,
    });
    return false;
  }

  const storedColumns = isSliceMetric
    ? baseState.slices?.find((sl) => sl.metricId === metric.id)?.columns
    : baseState.columns;
  if (!storedColumns) {
    log("metric not covered: no stored columns for metric/slice", {
      metricId: metric.id,
      isSliceMetric,
    });
    return false;
  }

  const requiredColumns = getColumnsForMetric(metric, factTableId);
  const covered = requiredColumns.every((c) => storedColumns.includes(c));
  if (!covered) {
    log("metric not covered: required columns missing from stored columns", {
      metricId: metric.id,
      requiredColumns,
      storedColumns,
    });
  }
  return covered;
}
