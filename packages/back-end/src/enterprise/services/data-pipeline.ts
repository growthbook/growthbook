import {
  ExperimentMetricInterface,
  isFactMetric,
  quantileMetricType,
} from "shared/experiments";
import { isExperimentIncrementalEnabled } from "shared/enterprise";
import { IncrementalRefreshInterface } from "shared/validators";
import {
  ExperimentSnapshotSettings,
  MetricForSnapshot,
} from "shared/types/experiment-snapshot";
import { ExperimentInterface } from "shared/types/experiment";
import { ExposureQuery } from "shared/types/datasource";
import { SegmentInterface } from "shared/types/segment";
import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { hashObject } from "back-end/src/util/hash.util";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { getFiltersForHash } from "back-end/src/services/experimentTimeSeries";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";

// If the given settings / experiment is not compatible with incremental refresh, throw an error.
// Otherwise, return void.
export async function validateIncrementalPipeline({
  context,
  integration,
  snapshotSettings,
  metricMap,
  factTableMap,
  experiment,
  incrementalRefreshModel,
  analysisType,
}: {
  context: ReqContext | ApiReqContext;
  integration: SourceIntegrationInterface;
  snapshotSettings: ExperimentSnapshotSettings;
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
  experiment: ExperimentInterface;
  incrementalRefreshModel: IncrementalRefreshInterface | null;
  analysisType: "main-update" | "main-fullRefresh" | "exploratory";
}): Promise<void> {
  if (snapshotSettings.skipPartialData) {
    throw new Error(
      "'Exclude In-Progress Conversions' is not supported for incremental refresh queries while in beta. Please select 'Include' in the Analysis Settings for Metric Conversion Windows.",
    );
  }

  if (!integration.getSourceProperties().hasIncrementalRefresh) {
    throw new Error("Integration does not support incremental refresh queries");
  }

  // Check if organization has the incremental refresh feature
  const hasIncrementalRefreshFeature = orgHasPremiumFeature(
    context.org,
    "incremental-refresh",
  );
  if (!hasIncrementalRefreshFeature) {
    throw new Error(
      "Organization does not have access to incremental refresh feature",
    );
  }

  const settings = integration.datasource.settings;
  if (
    !isExperimentIncrementalEnabled(settings.pipelineSettings, experiment.id)
  ) {
    throw new Error(
      "This experiment is not enabled for incremental refresh on this data source.",
    );
  }

  if (experiment.activationMetric) {
    throw new Error(
      "Activation metrics are not supported for incremental refresh while in beta.",
    );
  }

  // Get selected metrics
  const selectedMetrics = snapshotSettings.metricSettings
    .map((m) => metricMap.get(m.id))
    .filter((m) => m !== undefined);

  if (!selectedMetrics.length) {
    throw new Error("Experiment must have at least 1 metric selected.");
  }
  if (selectedMetrics.some((m) => !isFactMetric(m))) {
    throw new Error(
      "Only fact metrics are supported with incremental refresh.",
    );
  }

  selectedMetrics.filter(isFactMetric).forEach((metric) => {
    // Unit quantiles store a float and re-aggregate via SUM, so they work on
    // any incremental-capable warehouse. Only event quantiles need a quantile
    // sketch (the quantile must be computed over raw event values, which
    // requires a mergeable sketch for incremental aggregation).
    if (
      quantileMetricType(metric) === "event" &&
      !integration.getSourceProperties().hasQuantileSketch
    ) {
      throw new Error(
        "Event quantile metrics are not supported with incremental refresh on this data source.",
      );
    }
  });

  // If not forcing a full refresh and we have a previous run, ensure the
  // current configuration matches what the incremental pipeline was built with.
  if (analysisType === "main-update" && incrementalRefreshModel) {
    if (incrementalRefreshModel.experimentSettingsHash) {
      const exposureQuery =
        (settings.queries?.exposure || []).find(
          (q) => q.id === snapshotSettings.exposureQueryId,
        ) ?? null;
      const segment = snapshotSettings.segment
        ? await context.models.segments.getById(snapshotSettings.segment)
        : null;
      if (
        !experimentSettingsHashMatchesForIncrementalRefresh({
          storedHash: incrementalRefreshModel.experimentSettingsHash,
          snapshotSettings,
          exposureQuery,
          segment,
          factTableMap,
        })
      ) {
        throw new Error(
          "The experiment configuration is outdated. Please run a Full Refresh.",
        );
      }
    }

    // Validate metric settings hashes for existing metric sources
    if (incrementalRefreshModel.metricSources?.length) {
      const existingMetricHashMap = new Map<string, string>();
      incrementalRefreshModel.metricSources.forEach((source) => {
        source.metrics.forEach((metric) => {
          existingMetricHashMap.set(metric.id, metric.settingsHash);
        });
      });

      selectedMetrics.filter(isFactMetric).forEach((m) => {
        const storedHash = existingMetricHashMap.get(m.id);
        if (!storedHash) return;

        const currentHash = getMetricSettingsHashForIncrementalRefresh({
          factMetric: m,
          factTableMap: factTableMap,
          metricSettings: snapshotSettings.metricSettings.find(
            (ms) => ms.id === m.id,
          ),
        });

        if (currentHash !== storedHash) {
          const metricName = m.name ?? m.id;
          throw new Error(
            `The metric "${metricName}" configuration is outdated. Please run a Full Refresh.`,
          );
        }
      });
    }
  }
}

// Version prefix for the experiment settings hash. Bump whenever the set of
// hashed inputs changes so that hashes stored by older builds can still be
// compared with the matching legacy function below — a raw input change would
// otherwise read as "configuration outdated" for every existing pipeline and
// silently drop them all out of incremental refresh on deploy.
const EXPERIMENT_SETTINGS_HASH_VERSION_PREFIX = "v2:";

// Fields of `ExperimentSnapshotSettings` whose values change the incremental
// units table SQL or the data it accumulates. Any change to one of these MUST
// invalidate the units table and force a full refresh.
const HASHED_SNAPSHOT_SETTINGS_FIELDS_FOR_INCREMENTAL_REFRESH = [
  "activationMetric",
  "attributionModel",
  "queryFilter",
  "segment",
  "skipPartialData",
  "datasourceId",
  "exposureQueryId",
  "startDate",
  "regressionAdjustmentEnabled",
  "experimentId",
  "lookbackOverride",
  // Compiled into the exposure query and segment SQL as template variables
  "phase",
  "customFields",
] as const satisfies readonly (keyof ExperimentSnapshotSettings)[];

// Fields of `ExperimentSnapshotSettings` that are intentionally NOT part of
// the incremental-refresh hash:
// - endDate moves forward on every incremental update by design
// - dimensions / precomputedUnitDimensionIds / variations / statistical
//   settings only affect analysis-time queries, which are recomputed from the
//   units and metric source tables on every run (unit dimension columns are
//   additionally gated by `unitsDimensions` on the incremental refresh model)
// - metricSettings and the metric id lists are covered per-metric by
//   `getMetricSettingsHashForIncrementalRefresh`
type IgnoredSnapshotSettingsFieldForIncrementalRefresh =
  | "endDate"
  | "dimensions"
  | "precomputedUnitDimensionIds"
  | "metricSettings"
  | "goalMetrics"
  | "secondaryMetrics"
  | "guardrailMetrics"
  | "defaultMetricPriorSettings"
  | "variations"
  | "coverage"
  | "banditSettings"
  | "manual";

// Compile-time exhaustiveness guard, mirroring the one for metric computed
// settings below. When a field is added to `ExperimentSnapshotSettings`, this
// fails to compile until the new field is classified as hashed or ignored.
type UnhandledSnapshotSettingsFieldForIncrementalRefresh = Exclude<
  keyof ExperimentSnapshotSettings,
  | (typeof HASHED_SNAPSHOT_SETTINGS_FIELDS_FOR_INCREMENTAL_REFRESH)[number]
  | IgnoredSnapshotSettingsFieldForIncrementalRefresh
>;
export type SnapshotSettingsForIncrementalRefreshExhaustivenessCheck =
  AssertNever<UnhandledSnapshotSettingsFieldForIncrementalRefresh>;

// The units table SQL also depends on definitions that snapshotSettings only
// references by id. The ids don't change when the underlying SQL is edited,
// so the definitions themselves must be hashed — otherwise rows produced by
// the new definition get appended to a table built with the old one and the
// mixed data is analyzed as if it were consistent.
//
// The same classification discipline applies to these definition objects:
// when a field is added to ExposureQuery or SegmentInterface, the guards
// below fail to compile until it's classified as hashed or ignored.
type HashedExposureQueryField = "query" | "userIdType";
type IgnoredExposureQueryField =
  | "id" // hashed via snapshotSettings.exposureQueryId
  | "name"
  | "description" // cosmetic
  | "hasNameCol" // display-only
  | "dimensions"
  | "dimensionSlicesId"
  | "dimensionMetadata" // gated by unitsDimensions / recomputed at analysis time
  | "error"; // transient status
export type ExposureQueryForIncrementalRefreshExhaustivenessCheck = AssertNever<
  Exclude<
    keyof ExposureQuery,
    HashedExposureQueryField | IgnoredExposureQueryField
  >
>;

type HashedSegmentField =
  | "type"
  | "sql"
  | "userIdType"
  | "factTableId"
  | "filters"; // resolved to filter SQL below
type IgnoredSegmentField =
  | "id" // hashed via snapshotSettings.segment
  | "organization"
  | "owner"
  | "datasource" // hashed via snapshotSettings.datasourceId
  | "dateCreated"
  | "dateUpdated"
  | "name"
  | "description" // cosmetic
  | "managedBy"
  | "projects"; // access control, not SQL
export type SegmentForIncrementalRefreshExhaustivenessCheck = AssertNever<
  Exclude<keyof SegmentInterface, HashedSegmentField | IgnoredSegmentField>
>;

function getSegmentSettingsForHash(
  segment: SegmentInterface | null,
  factTableMap: FactTableMap,
) {
  if (!segment) return null;
  const factTable = segment.factTableId
    ? factTableMap.get(segment.factTableId)
    : undefined;
  return {
    type: segment.type,
    sql: segment.sql ?? null,
    userIdType: segment.userIdType ?? null,
    factTableId: segment.factTableId ?? null,
    factTableSql: factTable?.sql ?? null,
    // Resolved filter SQL, not just filter ids
    filters:
      factTable && segment.filters?.length
        ? factTable.filters
            .filter((f) => segment.filters?.includes(f.id))
            .map((f) => ({ id: f.id, value: f.value }))
        : null,
  };
}

export function getExperimentSettingsHashForIncrementalRefresh({
  snapshotSettings,
  exposureQuery,
  segment,
  factTableMap,
}: {
  snapshotSettings: ExperimentSnapshotSettings;
  exposureQuery: ExposureQuery | null;
  segment: SegmentInterface | null;
  factTableMap: FactTableMap;
}): string {
  // Normalize undefined to null so optional fields hash deterministically
  const snapshotSettingsFields = Object.fromEntries(
    HASHED_SNAPSHOT_SETTINGS_FIELDS_FOR_INCREMENTAL_REFRESH.map((field) => [
      field,
      snapshotSettings[field] ?? null,
    ]),
  );

  return (
    EXPERIMENT_SETTINGS_HASH_VERSION_PREFIX +
    hashObject({
      ...snapshotSettingsFields,
      exposureQuery: exposureQuery
        ? {
            query: exposureQuery.query,
            userIdType: exposureQuery.userIdType,
          }
        : null,
      segmentDefinition: getSegmentSettingsForHash(segment, factTableMap),
    })
  );
}

// The hash exactly as computed before the version prefix was introduced.
// Stored hashes without a version prefix were written by this function; keep
// it so those pipelines keep validating (and keep running incrementally)
// until the runner rewrites the stored hash on their next successful update.
function getLegacyExperimentSettingsHashForIncrementalRefresh(
  snapshotSettings: ExperimentSnapshotSettings,
): string {
  return hashObject({
    // snapshotSettings
    activationMetric: snapshotSettings.activationMetric,
    attributionModel: snapshotSettings.attributionModel,
    queryFilter: snapshotSettings.queryFilter,
    segment: snapshotSettings.segment,
    skipPartialData: snapshotSettings.skipPartialData,
    datasourceId: snapshotSettings.datasourceId,
    exposureQueryId: snapshotSettings.exposureQueryId,
    startDate: snapshotSettings.startDate,
    regressionAdjustmentEnabled: snapshotSettings.regressionAdjustmentEnabled,
    experimentId: snapshotSettings.experimentId,
  });
}

export function experimentSettingsHashMatchesForIncrementalRefresh({
  storedHash,
  snapshotSettings,
  exposureQuery,
  segment,
  factTableMap,
}: {
  storedHash: string;
  snapshotSettings: ExperimentSnapshotSettings;
  exposureQuery: ExposureQuery | null;
  segment: SegmentInterface | null;
  factTableMap: FactTableMap;
}): boolean {
  if (!storedHash.startsWith(EXPERIMENT_SETTINGS_HASH_VERSION_PREFIX)) {
    // Hash written by an older build. The inputs added since then weren't
    // captured at units-table build time, so they can't be validated
    // retroactively; they're covered from the next successful update onward.
    return (
      storedHash ===
      getLegacyExperimentSettingsHashForIncrementalRefresh(snapshotSettings)
    );
  }
  return (
    storedHash ===
    getExperimentSettingsHashForIncrementalRefresh({
      snapshotSettings,
      exposureQuery,
      segment,
      factTableMap,
    })
  );
}

type ComputedSettingsForSnapshot = NonNullable<
  MetricForSnapshot["computedSettings"]
>;

// Fields of `MetricForSnapshot.computedSettings` whose values change the
// queries we run or the data they return for incremental refresh. Any change
// to one of these MUST invalidate the metric source and force a full refresh.
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

// NOTE: like the experiment settings hash above, this hash is stored (on
// each metric source) and compared across deploys. If the set of hashed
// inputs here ever changes, apply the same version-prefix + legacy-comparison
// treatment used for the experiment settings hash — a raw input change would
// invalidate every stored metric source on deploy.
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
