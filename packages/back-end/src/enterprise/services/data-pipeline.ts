import md5 from "md5";
import {
  ExperimentMetricInterface,
  getAutoSliceMetrics,
  isSliceMetric,
} from "shared/experiments";
import {
  getIncrementalPipelineUnsupportedReason,
  INCREMENTAL_FULL_REFRESH_SETTINGS_FIELDS,
  overallResultsBuiltWithoutIncrementalPipeline,
} from "shared/enterprise";
import {
  AggregatedFactTableInterface,
  AggregatedFactTableMetricStateInterface,
  IncrementalRefreshInterface,
} from "shared/validators";
import {
  ExperimentSnapshotSettings,
  MetricForSnapshot,
} from "shared/types/experiment-snapshot";
import { OrganizationInterface } from "shared/types/organization";
import { ExperimentInterface } from "shared/types/experiment";
import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { ExperimentIncrementalPipelineRequiresFullRefreshError } from "back-end/src/util/errors";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { getFiltersForHash } from "back-end/src/services/experimentTimeSeries";
import { getColumnsForMetric } from "back-end/src/integrations/sql/fact-metrics/columns-for-metric";
import type { MetricFanOut } from "back-end/src/services/experimentQueries/planMetricFanOut";

/**
 * Preconditions for running the incremental refresh query runner on a snapshot.
 * Throws when incremental refresh is unsupported for this configuration, or when
 * an incremental update would reuse a units table built under different
 * experiment-level settings.
 *
 * Does not validate metric-source cache drift. See getFactTablesNeedingRebuild.
 */
export async function assertIncrementalRefreshPrerequisites({
  org,
  integration,
  snapshotSettings,
  metricMap,
  experiment,
  incrementalRefreshModel,
  analysisType,
}: {
  org: OrganizationInterface;
  integration: SourceIntegrationInterface;
  snapshotSettings: ExperimentSnapshotSettings;
  metricMap: Map<string, ExperimentMetricInterface>;
  experiment: ExperimentInterface;
  incrementalRefreshModel: IncrementalRefreshInterface | null;
  analysisType: "main-update" | "main-fullRefresh" | "exploratory";
}): Promise<void> {
  const selectedMetrics = snapshotSettings.metricSettings
    .map((m) => metricMap.get(m.id))
    .filter((m) => m !== undefined);

  const unsupportedReason = getIncrementalPipelineUnsupportedReason({
    datasourceProperties: integration.getSourceProperties(),
    pipelineSettings: integration.datasource.settings.pipelineSettings,
    experimentId: experiment.id,
    orgHasIncrementalPipelineFeature: orgHasPremiumFeature(
      org,
      "incremental-refresh",
    ),
    skipPartialData: snapshotSettings.skipPartialData,
    activationMetric: experiment.activationMetric,
    metrics: selectedMetrics,
    experimentType: experiment.type,
  });

  if (unsupportedReason) {
    throw new Error(unsupportedReason);
  }

  // If not forcing a full refresh and we have a previous run, ensure the
  // experiment-level configuration matches what the incremental pipeline was
  // built with. Experiment-level changes (attribution model, exposure query,
  // segment, query filter, start date, regression-adjustment toggle) reshape
  // the units table and everything downstream, so they require a full refresh.
  //
  // Per-metric settings changes are intentionally NOT validated here. A changed
  // metric is recoverable without a full refresh: the incremental runner
  // detects the metric-source hash drift (see getFactTablesNeedingRebuild) and
  // rebuilds only that metric's fact-table cache, leaving the units table and
  // every unaffected metric cache on the incremental path.
  if (analysisType === "main-update" && incrementalRefreshModel) {
    const currentSettingsHash =
      getExperimentSettingsHashForIncrementalRefresh(snapshotSettings);
    const storedSettingsHash = incrementalRefreshModel.experimentSettingsHash;
    if (!storedSettingsHash || currentSettingsHash !== storedSettingsHash) {
      throw new ExperimentIncrementalPipelineRequiresFullRefreshError(
        "The experiment configuration is outdated. Please run a Full Refresh.",
      );
    }
  }
}

const hashObject = (obj: object) => md5(JSON.stringify(obj));

export function getExperimentSettingsHashForIncrementalRefresh(
  snapshotSettings: ExperimentSnapshotSettings,
): string {
  const settingsForHash: Record<string, unknown> = {};

  for (const field of INCREMENTAL_FULL_REFRESH_SETTINGS_FIELDS) {
    settingsForHash[field] = snapshotSettings[field];
  }

  return hashObject(settingsForHash);
}

type ComputedSettingsForSnapshot = NonNullable<
  MetricForSnapshot["computedSettings"]
>;

// Fields of `MetricForSnapshot.computedSettings` whose values change the
// queries we run or the data they return for incremental refresh. Any change
// to one of these triggers a per-fact-table cache rebuild via
// getFactTablesNeedingRebuild (not a full experiment refresh).
const HASHED_COMPUTED_SETTINGS_FIELDS_FOR_INCREMENTAL_REFRESH = [
  "regressionAdjustmentEnabled",
  "regressionAdjustmentDays",
  "windowSettings",
] as const satisfies readonly (keyof ComputedSettingsForSnapshot)[];

// Fields of `MetricForSnapshot.computedSettings` that are intentionally NOT
// part of the incremental-refresh hash because they only affect analysis-time
// interpretation, not the SQL we generate. Spurious changes to these (e.g.
// `regressionAdjustmentReason` flipping between different free-text strings)
// must not trigger a full refresh.
type IgnoredComputedSettingsFieldForIncrementalRefresh =
  | "regressionAdjustmentAvailable"
  | "regressionAdjustmentReason"
  | "properPrior"
  | "properPriorMean"
  | "properPriorStdDev"
  | "targetMDE";

// Compile-time exhaustiveness guard. When a field is added to
// `MetricForSnapshot.computedSettings`, this resolves to that field's literal
// type instead of `never`, and the `AssertNever` constraint below fails to
// compile. Classify the new field in the hashed array or ignored union above
// to fix it.
type AssertNever<T extends never> = T;
type UnhandledComputedSettingsFieldForIncrementalRefresh = Exclude<
  keyof ComputedSettingsForSnapshot,
  | (typeof HASHED_COMPUTED_SETTINGS_FIELDS_FOR_INCREMENTAL_REFRESH)[number]
  | IgnoredComputedSettingsFieldForIncrementalRefresh
>;
export type ComputedSettingsForIncrementalRefreshExhaustivenessCheck =
  AssertNever<UnhandledComputedSettingsFieldForIncrementalRefresh>;

export function getMetricSettingsHashForIncrementalRefresh({
  factMetric,
  factTableMap,
  metricSettings,
}: {
  factMetric: FactMetricInterface;
  factTableMap: Map<string, FactTableInterface>;
  metricSettings?: MetricForSnapshot;
}): string {
  const numeratorFactTableId = factMetric.numerator.factTableId;
  const numeratorFactTable = numeratorFactTableId
    ? factTableMap?.get(numeratorFactTableId)
    : undefined;

  const denominatorFactTableId = factMetric.denominator?.factTableId;
  const denominatorFactTable = denominatorFactTableId
    ? factTableMap?.get(denominatorFactTableId)
    : undefined;

  const computedSettings = metricSettings?.computedSettings;
  const hashedComputedSettings: Partial<ComputedSettingsForSnapshot> =
    computedSettings
      ? Object.fromEntries(
          HASHED_COMPUTED_SETTINGS_FIELDS_FOR_INCREMENTAL_REFRESH.map(
            (field) => [field, computedSettings[field]],
          ),
        )
      : {};

  return hashObject({
    ...hashedComputedSettings,
    metricType: factMetric.metricType,
    numerator: factMetric.numerator,
    denominator: factMetric.denominator,
    cappingSettings: factMetric.cappingSettings,
    quantileSettings: factMetric.quantileSettings,
    numeratorFactTable: {
      sql: numeratorFactTable?.sql,
      eventName: numeratorFactTable?.eventName,
      filters: getFiltersForHash(numeratorFactTable, factMetric.numerator),
    },
    denominatorFactTable: {
      sql: denominatorFactTable?.sql,
      eventName: denominatorFactTable?.eventName,
      // filters should be added here as well in case it is a cross
      // fact table ratio metric
      filters: getFiltersForHash(denominatorFactTable, factMetric.denominator),
    },
  });
}

/**
 * Compares the persisted incremental-refresh cache state against the desired
 * metric fan-out and the current per-metric settings hashes, returning the set
 * of fact tables whose cache tables must be rebuilt from scratch (CREATE +
 * full INSERT) instead of incrementally appended.
 *
 * A fact table needs a rebuild when any of these drift from the persisted cache:
 *   - A metric now maps to it that the cache doesn't hold yet (added metric).
 *   - The cache holds a (factTableId, metricId) tuple that's no longer desired
 *     (removed metric, or a cross-FT ratio side that moved to the other FT).
 *   - A metric still maps to it but its `settingsHash` changed — the cache's
 *     schema/values are out of shape with the metric's new configuration
 *     (conversion window, column refs, fact-table SQL/filters, CUPED days, …).
 *
 * The settings-hash case is what lets a changed metric recover incrementally:
 * only that metric's fact-table cache is rebuilt, while the units table and
 * every unaffected metric cache stay on the incremental path. Cross-FT ratio
 * metrics carry the same `settingsHash` in both of their fact tables' caches,
 * so a settings change flags both sides. Experiment-level setting changes are
 * out of scope — they force a full refresh upstream in
 * `assertIncrementalRefreshPrerequisites`.
 */
export function getFactTablesNeedingRebuild({
  existingMetricSources,
  desiredFanOut,
  currentMetricSettingsHashes,
}: {
  existingMetricSources: IncrementalRefreshInterface["metricSources"];
  desiredFanOut: MetricFanOut;
  currentMetricSettingsHashes: Map<string, string>;
}): Set<string> {
  const factTablesToRebuild = new Set<string>();
  if (!existingMetricSources.length) return factTablesToRebuild;

  // (factTableId, metricId) tuples the persisted caches currently hold.
  const storedTuples = new Set<string>();
  existingMetricSources.forEach((source) => {
    source.metrics.forEach((m) => {
      storedTuples.add(`${source.factTableId}|${m.id}`);
    });
  });

  // Added tuples: a metric now maps to an FT whose cache doesn't hold it yet.
  // Growing the cache changes its schema, so rebuild it.
  const desiredTuples = new Set<string>();
  desiredFanOut.perFt.forEach(({ factTableId, metrics }) => {
    metrics.forEach((metric) => {
      const tuple = `${factTableId}|${metric.id}`;
      desiredTuples.add(tuple);
      if (!storedTuples.has(tuple)) {
        factTablesToRebuild.add(factTableId);
      }
    });
  });

  existingMetricSources.forEach((source) => {
    source.metrics.forEach((m) => {
      // Orphaned tuple: the cache holds a metric (or a cross-FT ratio side)
      // that's no longer desired. Rebuild so the schema sheds the dead column.
      if (!desiredTuples.has(`${source.factTableId}|${m.id}`)) {
        factTablesToRebuild.add(source.factTableId);
        return;
      }
      // Settings drift (or missing current hash): recompute the cache from
      // scratch so the persisted values reflect the new settings.
      const currentHash = currentMetricSettingsHashes.get(m.id);
      if (currentHash === undefined || currentHash !== m.settingsHash) {
        factTablesToRebuild.add(source.factTableId);
      }
    });
  });

  return factTablesToRebuild;
}

// Hash of only the schema-breaking parts of a fact metric (fields that change
// the materialized table's column set or stored data types). Tolerable changes
// (capping, conversion windows, thresholds, etc.) affect read-time
// interpretation only and are excluded; an included field changing triggers a
// nightly full-table restate. `factTableId` decides which metric side(s) this
// table stores.
export function getMetricSettingsHashForAggregatedFactTable({
  factMetric,
  factTableId,
}: {
  factMetric: FactMetricInterface;
  factTableId: string;
}): string {
  const includeNumerator = factMetric.numerator.factTableId === factTableId;
  const includeDenominator =
    !!factMetric.denominator &&
    factMetric.denominator.factTableId === factTableId;

  // Only the column-ref parts that change stored data type / column name. The
  // aggregate-filter threshold is omitted (it changes values, not schema).
  const schemaBreakingColumnRef = (
    ref: FactMetricInterface["numerator"] | null | undefined,
  ) =>
    ref
      ? {
          factTableId: ref.factTableId,
          column: ref.column,
          aggregation: ref.aggregation,
        }
      : null;

  return hashObject({
    metricType: factMetric.metricType,
    numerator: includeNumerator
      ? schemaBreakingColumnRef(factMetric.numerator)
      : null,
    denominator: includeDenominator
      ? schemaBreakingColumnRef(factMetric.denominator)
      : null,
    // Event vs unit quantiles change whether `_value` is a sketch and whether a
    // paired `_n_events` column exists.
    quantileType: factMetric.quantileSettings?.type ?? null,
  });
}

// Hash of the fact-table definition, stored on the registry to detect FT drift.
export function getFactTableSettingsHashForAggregatedFactTable(
  factTable: FactTableInterface,
): string {
  return hashObject({
    sql: factTable.sql,
    eventName: factTable.eventName,
    filters: (factTable.filters ?? [])
      .map((f) => ({ id: f.id, value: f.value }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

// Builds the schema state the nightly job persists on the registry: the
// fact-table definition hash plus per-metric state (settings hash + the
// columns each metric/slice materializes). `metrics` must already be the
// flattened set (base metrics + auto-slice variants) the run will materialize.
export function buildAggregatedFactTableSchemaState({
  factTable,
  metrics,
}: {
  factTable: FactTableInterface;
  metrics: FactMetricInterface[];
}): {
  factTableSettingsHash: string;
  metricState: AggregatedFactTableMetricStateInterface[];
} {
  const factTableSettingsHash =
    getFactTableSettingsHashForAggregatedFactTable(factTable);

  const metricState: AggregatedFactTableMetricStateInterface[] = metrics.map(
    (metric) => ({
      metricId: metric.id,
      settingsHash: getMetricSettingsHashForAggregatedFactTable({
        factMetric: metric,
        factTableId: factTable.id,
      }),
      columns: getColumnsForMetric(metric, factTable.id),
      // Slice metrics are already flattened into `metrics`; only base metrics
      // own the slice list (calling getAutoSliceMetrics on a slice clones again).
      slices: isSliceMetric(metric)
        ? []
        : getAutoSliceMetrics({ metric, factTable }).map((sliceMetric) => ({
            metricId: sliceMetric.id,
            columns: getColumnsForMetric(sliceMetric, factTable.id),
          })),
      builtAt: new Date(),
    }),
  );

  return { factTableSettingsHash, metricState };
}

// True when the materialized table is missing a column the current metric set
// needs, or has a column whose type no longer matches. Only additions and
// type changes drift: a removed/disabled metric or slice just leaves a harmless
// orphan column the append insert and read path ignore, so it is tolerated to
// avoid a needless restate. Re-adding such a metric still drifts, because the
// reduced metric set was persisted to the registry on the tolerating run, so
// the metric reads as a new addition. Comparisons are order-independent.
export function detectAggregatedFactTableSchemaDrift({
  registry,
  factTableSettingsHash,
  metricState,
}: {
  registry: Pick<
    AggregatedFactTableInterface,
    "tableFullName" | "factTableSettingsHash" | "metricState"
  >;
  factTableSettingsHash: string;
  metricState: AggregatedFactTableMetricStateInterface[];
}): { drift: boolean; reason?: string } {
  // Defensive: a materialized table with no recorded metric state can't be
  // safely appended to.
  if (registry.tableFullName && !registry.metricState.length) {
    return { drift: true, reason: "missing metric state" };
  }

  if (factTableSettingsHash !== registry.factTableSettingsHash) {
    return { drift: true, reason: "fact table definition changed" };
  }

  const prevById = new Map(registry.metricState.map((m) => [m.metricId, m]));

  // Only inspect the current metric set: a metric in `prev` but not in `next`
  // is a tolerated removal (orphan column). An added metric or a changed
  // settings/slice column is what requires a rebuild.
  for (const [metricId, next] of metricState.map(
    (m) => [m.metricId, m] as const,
  )) {
    const prev = prevById.get(metricId);
    if (!prev) {
      return { drift: true, reason: `metric ${metricId} added` };
    }
    if (prev.settingsHash !== next.settingsHash) {
      return { drift: true, reason: `metric ${metricId} settings changed` };
    }
    const prevSlices = new Set((prev.slices ?? []).map((s) => s.metricId));
    const nextSlices = new Set((next.slices ?? []).map((s) => s.metricId));
    if ([...nextSlices].some((s) => !prevSlices.has(s))) {
      return { drift: true, reason: `metric ${metricId} slices added` };
    }
  }

  return { drift: false };
}

export type AggregatedFactTableRestateReason =
  // A prior run appended but never durably advanced the watermark, so the
  // table may contain rows the watermark doesn't account for.
  "incomplete-write" | "schema-drift" | null;

// The single predicate the driver and the status UI both use to decide whether
// an already-materialized table needs to be rebuilt rather than incrementally
// appended to. First-run (no table yet) is handled by the caller.
export function getAggregatedFactTableRestateReason({
  registry,
  factTableSettingsHash,
  metricState,
}: {
  registry: Pick<
    AggregatedFactTableInterface,
    | "tableFullName"
    | "factTableSettingsHash"
    | "metricState"
    | "inFlightExecutionId"
  >;
  factTableSettingsHash: string;
  metricState: AggregatedFactTableMetricStateInterface[];
}): AggregatedFactTableRestateReason {
  if (!registry.tableFullName) return null;
  if ((registry.inFlightExecutionId ?? null) !== null) {
    return "incomplete-write";
  }
  if (
    detectAggregatedFactTableSchemaDrift({
      registry,
      factTableSettingsHash,
      metricState,
    }).drift
  ) {
    return "schema-drift";
  }
  return null;
}

// True when a dimension breakdown would read a units table built under different
// experiment-level settings.
export function exploratoryOverallRequiresFullRefresh({
  snapshotSettings,
  incrementalRefreshModel,
  latestOverallSnapshotId,
}: {
  snapshotSettings: ExperimentSnapshotSettings;
  incrementalRefreshModel: IncrementalRefreshInterface;
  latestOverallSnapshotId: string | null;
}): boolean {
  const currentSettingsHash =
    getExperimentSettingsHashForIncrementalRefresh(snapshotSettings);
  const storedSettingsHash = incrementalRefreshModel.experimentSettingsHash;
  if (!storedSettingsHash || currentSettingsHash !== storedSettingsHash) {
    return true;
  }
  return overallResultsBuiltWithoutIncrementalPipeline({
    unitsTableFullName: incrementalRefreshModel.unitsTableFullName,
    materializedBySnapshotId: incrementalRefreshModel.materializedBySnapshotId,
    latestOverallSnapshotId,
  });
}
