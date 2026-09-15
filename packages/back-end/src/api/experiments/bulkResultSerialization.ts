import { isEqual } from "lodash";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { isDefined } from "shared/util";
import {
  ExperimentMetricInterface,
  getFunnelStepMetric,
  isDimensionPrecomputed,
  isFactFunnelMetric,
  parseDimensionId,
  parseFunnelStepMetricId,
  parseSliceMetricId,
} from "shared/experiments";
import { ApiExperimentBulkResult, LookbackOverride } from "shared/validators";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
  SnapshotMetric,
} from "shared/types/experiment-snapshot";
import { ExperimentInterface } from "shared/types/experiment";
import { ExperimentReportResultDimension } from "shared/types/report";
import { DifferenceType, StatsEngine } from "shared/types/stats";
import { safeFloatOrNull } from "back-end/src/services/experiments";

export function buildExperimentBulkResultId(
  snapshotId: string,
  dimensionId: string,
): string {
  return dimensionId
    ? `${snapshotId}:dimension:${encodeURIComponent(dimensionId)}`
    : `${snapshotId}:overall`;
}

// Resolve a snapshot/analysis dimension id into an API-friendly descriptor.
// `type` is never "precomputed": precomputed is an orthogonal execution detail
// (the dimension was computed eagerly in one pass), so we resolve to the
// underlying dimension kind and expose a separate boolean.
function parseApiResultDimension(
  dimensionId: string,
  precomputedUnitDimensionIds: string[],
): ApiExperimentBulkResult["dimension"] {
  if (!dimensionId) {
    return { type: "none", precomputed: false };
  }

  const precomputed = isDimensionPrecomputed(
    dimensionId,
    precomputedUnitDimensionIds,
  );

  const parsed = parseDimensionId(dimensionId);
  switch (parsed.kind) {
    case "experiment":
      return { type: "experiment", id: parsed.column, precomputed };
    case "date":
      return { type: "date", precomputed };
    case "activation":
      return { type: "activation", precomputed };
    case "datecutoff":
      return {
        type: "datecutoff",
        id: parsed.cutoff.toISOString(),
        precomputed,
      };
    case "combo":
      return {
        type: "combo",
        precomputed,
        dimensions: parsed.constituentIds.map((c) => {
          const constituent = parseDimensionId(c);
          return constituent.kind === "experiment"
            ? { type: "experiment", id: constituent.column }
            : { type: "user", id: c };
        }),
      };
    case "invalid":
      // Preserve legacy output for unrecognized "pre:*" ids stored on old snapshots
      return { type: dimensionId.replace(/^pre:/, ""), precomputed };
    case "user":
      // Possibly a precomputed unit dimension.
      return { type: "user", id: parsed.id, precomputed };
  }
}

// Builds a metric display-name resolver that formats slice metrics as
// "Parent (col: val, ...)" and funnel step metrics as "Parent: Step" so
// payloads are self-describing.
export function buildResultMetricNameResolver(
  metricIds: Iterable<string>,
  metricsById: Map<string, ExperimentMetricInterface>,
): (id: string) => string | undefined {
  const baseMetricIds = Array.from(
    new Set(
      Array.from(metricIds).map((id) => parseSliceMetricId(id).baseMetricId),
    ),
  );
  const baseMetricsById = new Map(
    baseMetricIds.flatMap((id) => {
      const m = metricsById.get(id);
      return m ? [[id, m] as const] : [];
    }),
  );
  return (id: string): string | undefined => {
    const stepInfo = parseFunnelStepMetricId(id);
    if (stepInfo.isFunnelStepMetric && stepInfo.stepIndex !== null) {
      const parent = baseMetricsById.get(stepInfo.baseMetricId);
      if (!parent || !isFactFunnelMetric(parent)) return undefined;
      return getFunnelStepMetric(parent, stepInfo.stepIndex)?.name;
    }

    const { baseMetricId, sliceLevels } = parseSliceMetricId(id);
    const baseName = baseMetricsById.get(baseMetricId)?.name;
    if (!baseName) return undefined;
    if (!sliceLevels.length) return baseName;
    const sliceContext = sliceLevels
      .map(
        (s) =>
          `${s.column}: ${s.levels.length ? s.levels.join(" OR ") : "other"}`,
      )
      .join(", ");
    return `${baseName} (${sliceContext})`;
  };
}

const API_RESULT_DIFFERENCE_TYPES: DifferenceType[] = [
  "relative",
  "absolute",
  "scaled",
];

// Returns the base analysis followed by the variants that differ from it only
// by difference type, when they exist and succeeded. Ad-hoc setting variants
// (different baseline, engine, etc.) never match the settings equality check.
function getDifferenceTypeVariants(
  analyses: ExperimentSnapshotAnalysis[],
  baseAnalysis: ExperimentSnapshotAnalysis,
): ExperimentSnapshotAnalysis[] {
  const variants = API_RESULT_DIFFERENCE_TYPES.filter(
    (differenceType) => differenceType !== baseAnalysis.settings.differenceType,
  )
    .map((differenceType) =>
      analyses.find(
        (a) =>
          a.status === "success" &&
          isEqual(a.settings, { ...baseAnalysis.settings, differenceType }),
      ),
    )
    .filter(isDefined);
  return [baseAnalysis, ...variants];
}

// Precomputed dimension ids that have at least one analysis on the snapshot.
function getPrecomputedDimensionIdsInAnalyses(
  snapshot: ExperimentSnapshotInterface,
): string[] {
  const precomputedUnitDimensionIds =
    snapshot.settings.precomputedUnitDimensionIds ?? [];
  const ids = new Set<string>();
  for (const analysis of snapshot.analyses) {
    const dimensionId = analysis.settings.dimensions[0];
    if (
      dimensionId &&
      isDimensionPrecomputed(dimensionId, precomputedUnitDimensionIds)
    ) {
      ids.add(dimensionId);
    }
  }
  return Array.from(ids);
}

// Maps a single per-variation SnapshotMetric into a bulk-results API analysis
// entry for a given stats engine + difference type. Missing/non-finite stats
// are emitted as null.
export function toApiResultAnalysis(
  engine: StatsEngine,
  differenceType: DifferenceType,
  data: SnapshotMetric | undefined,
) {
  return {
    engine,
    differenceType,
    numerator: safeFloatOrNull(data?.value),
    denominator: safeFloatOrNull(data?.denominator),
    mean: safeFloatOrNull(data?.stats?.mean),
    stddev: safeFloatOrNull(data?.stats?.stddev),
    effect: safeFloatOrNull(data?.expected),
    effectStandardError: safeFloatOrNull(data?.uplift?.stddev),
    ciLow: safeFloatOrNull(data?.ci?.[0]),
    ciHigh: safeFloatOrNull(data?.ci?.[1]),
    pValue: safeFloatOrNull(data?.pValue),
    chanceToBeatControl: safeFloatOrNull(data?.chanceToWin),
    ...(data?.errorMessage ? { errorMessage: data.errorMessage } : null),
  };
}

// Snapshot-time effective metric settings, read from the stored
// metricSettings[].computedSettings. Returns just `{ metricId }` for legacy
// snapshots that predate computed settings (no invented values).
function buildBulkResultMetric(
  metricId: string,
  snapshot: ExperimentSnapshotInterface,
): ApiExperimentBulkResult["settings"]["goals"][number] {
  const { baseMetricId } = parseSliceMetricId(metricId);
  const metricSettings =
    snapshot.settings.metricSettings.find((m) => m.id === metricId) ??
    snapshot.settings.metricSettings.find((m) => m.id === baseMetricId);
  const computed = metricSettings?.computedSettings;
  const windowSettings = computed?.windowSettings;
  if (!computed || !windowSettings) {
    return { metricId };
  }
  return {
    metricId,
    effectiveSettings: {
      windowType: windowSettings.type,
      windowValue: windowSettings.windowValue,
      windowUnit: windowSettings.windowUnit,
      delayValue: windowSettings.delayValue,
      delayUnit: windowSettings.delayUnit,
      properPrior: computed.properPrior,
      properPriorMean: computed.properPriorMean,
      properPriorStdDev: computed.properPriorStdDev,
      regressionAdjustmentEnabled: computed.regressionAdjustmentEnabled,
      regressionAdjustmentDays: computed.regressionAdjustmentDays,
      ...(computed.targetMDE !== undefined
        ? { targetMDE: computed.targetMDE }
        : null),
    },
  };
}

// Maps a stored snapshot lookback override to the API shape (date values are
// serialized to ISO strings; window values stay numeric with their unit).
function toApiBulkLookbackOverride(
  lookbackOverride: LookbackOverride,
): ApiExperimentBulkResult["settings"]["lookbackOverride"] {
  if (lookbackOverride.type === "date") {
    return { type: "date", value: lookbackOverride.value.toISOString() };
  }
  return {
    type: "window",
    value: lookbackOverride.value,
    valueUnit: lookbackOverride.valueUnit,
  };
}

// Serializes a single snapshot into one ExperimentBulkResult item per
// dimension, using a curated selection of analyses: the default (0th)
// analysis plus the variants differing from it only by difference type
// (absolute/scaled), folded into each variation's `analyses` array. Precomputed
// dimensions that have analyses on the snapshot become additional items using
// the same selection rule. Ad-hoc setting variants (different baseline,
// engine, the internal covariate-as-response helper, etc.) are never included.
//
// Unlike toSnapshotApiInterface, this payload is snapshot-authoritative:
// settings, metric lists, effective metric settings, the analysis window, and
// variation identity all come from the stored snapshot + the analysis that
// produced the numbers. Current experiment values are used only to resolve
// display names (best-effort) or as a fallback for absent legacy fields.
export function toExperimentSnapshotBulkResultsApiInterface(
  experiment: ExperimentInterface,
  snapshot: ExperimentSnapshotInterface,
  metricsById: Map<string, ExperimentMetricInterface>,
): ApiExperimentBulkResult[] {
  const defaultAnalysis = snapshot.analyses[0];
  if (!defaultAnalysis || defaultAnalysis.status !== "success") return [];

  const phase = experiment.phases[snapshot.phase];

  // Resolve current internal id/name by matching the snapshot's stored
  // variation key (never by blindly indexing the current phase). Keys are
  // matched first, falling back to internal ids for older snapshots that
  // stored ids as keys.
  const currentVariationByKey = new Map(
    experiment.variations.map((v) => [v.key, v] as const),
  );
  const currentVariationById = new Map(
    experiment.variations.map((v) => [v.id, v] as const),
  );

  const activationMetric = snapshot.settings.activationMetric;

  const precomputedUnitDimensionIds =
    snapshot.settings.precomputedUnitDimensionIds ?? [];

  // One analysis group per dimension: the default analysis's dimension first,
  // then precomputed dimensions that have a matching base analysis.
  const defaultDimensionId = defaultAnalysis.settings.dimensions[0] || "";
  const analysesByDimension = new Map<string, ExperimentSnapshotAnalysis[]>();
  analysesByDimension.set(
    defaultDimensionId,
    getDifferenceTypeVariants(snapshot.analyses, defaultAnalysis),
  );
  for (const dimensionId of getPrecomputedDimensionIdsInAnalyses(snapshot)) {
    if (dimensionId === defaultDimensionId) continue;
    const dimensionBaseAnalysis = snapshot.analyses.find(
      (a) =>
        a.status === "success" &&
        isEqual(a.settings, {
          ...defaultAnalysis.settings,
          dimensions: [dimensionId],
        }),
    );
    if (!dimensionBaseAnalysis) continue;
    analysesByDimension.set(
      dimensionId,
      getDifferenceTypeVariants(snapshot.analyses, dimensionBaseAnalysis),
    );
  }

  // Analysis window frozen at snapshot time; fall back to phase dates only for
  // legacy snapshots without stored settings dates.
  const dateStart =
    snapshot.settings.startDate?.toISOString() ||
    phase?.dateStarted?.toISOString() ||
    "";
  const dateEnd =
    snapshot.settings.endDate?.toISOString() ||
    phase?.dateEnded?.toISOString() ||
    snapshot.runStarted?.toISOString() ||
    "";

  // Data-generation settings are identical across dimensions of one snapshot;
  // per-analysis stats options (statsEngine, regressionAdjustment, etc.) are
  // added per item below.
  const baseSettings = {
    datasourceId: snapshot.settings.datasourceId || experiment.datasource || "",
    assignmentQueryId:
      snapshot.settings.exposureQueryId || experiment.exposureQueryId || "",
    experimentId: snapshot.settings.experimentId || experiment.trackingKey,
    segmentId: snapshot.settings.segment,
    queryFilter: snapshot.settings.queryFilter,
    inProgressConversions: snapshot.settings.skipPartialData
      ? ("exclude" as const)
      : ("include" as const),
    attributionModel:
      snapshot.settings.attributionModel ||
      experiment.attributionModel ||
      "firstExposure",
    ...(snapshot.settings.lookbackOverride
      ? {
          lookbackOverride: toApiBulkLookbackOverride(
            snapshot.settings.lookbackOverride,
          ),
        }
      : null),
    goals: snapshot.settings.goalMetrics.map((m) =>
      buildBulkResultMetric(m, snapshot),
    ),
    secondaryMetrics: snapshot.settings.secondaryMetrics.map((m) =>
      buildBulkResultMetric(m, snapshot),
    ),
    guardrails: snapshot.settings.guardrailMetrics.map((m) =>
      buildBulkResultMetric(m, snapshot),
    ),
    ...(activationMetric
      ? { activationMetric: buildBulkResultMetric(activationMetric, snapshot) }
      : null),
  };

  const items: ApiExperimentBulkResult[] = [];

  for (const [dimensionId, analyses] of analysesByDimension) {
    // The default (first) analysis establishes the result structure; every
    // analysis in the group contributes an inner analysis entry.
    const baseAnalysis = analyses[0];

    const metricIds = new Set<string>();
    analyses.forEach((a) => {
      (a.results || []).forEach((s) => {
        s.variations.forEach((v) => {
          Object.keys(v.metrics).forEach((m) => metricIds.add(m));
        });
      });
    });

    const getMetricName = buildResultMetricNameResolver(metricIds, metricsById);

    // Index each analysis's result dimensions by slice name so difference
    // types align even if analyses order their slices differently.
    const sliceByNamePerAnalysis = analyses.map((a) => {
      const sliceByName = new Map<string, ExperimentReportResultDimension>();
      (a.results || []).forEach((s) => sliceByName.set(s.name, s));
      return { analysis: a, sliceByName };
    });

    const dimension = parseApiResultDimension(
      dimensionId,
      precomputedUnitDimensionIds,
    );

    items.push({
      id: buildExperimentBulkResultId(snapshot.id, dimensionId),
      snapshotId: snapshot.id,
      experimentId: snapshot.experiment,
      phase: snapshot.phase + "",
      type: snapshot.type ?? "standard",
      ...(snapshot.triggeredBy ? { triggeredBy: snapshot.triggeredBy } : null),
      ...(snapshot.report ? { reportId: snapshot.report } : null),
      dateCreated: snapshot.dateCreated.toISOString(),
      dateStart,
      dateEnd,
      dimension,
      settings: {
        ...baseSettings,
        statsEngine: baseAnalysis.settings.statsEngine || DEFAULT_STATS_ENGINE,
        regressionAdjustmentEnabled:
          baseAnalysis.settings.regressionAdjusted ?? false,
        ...(baseAnalysis.settings.sequentialTesting !== undefined
          ? {
              sequentialTestingEnabled: baseAnalysis.settings.sequentialTesting,
            }
          : null),
        ...(baseAnalysis.settings.sequentialTestingTuningParameter !== undefined
          ? {
              sequentialTestingTuningParameter:
                baseAnalysis.settings.sequentialTestingTuningParameter,
            }
          : null),
        ...(baseAnalysis.settings.postStratificationEnabled !== undefined
          ? {
              postStratificationEnabled:
                baseAnalysis.settings.postStratificationEnabled,
            }
          : null),
        ...(baseAnalysis.settings.pValueThreshold !== undefined
          ? { pValueThreshold: baseAnalysis.settings.pValueThreshold }
          : null),
      },
      results: (baseAnalysis.results || []).map((s) => {
        return {
          dimensionValue: s.name,
          totalUsers: s.variations.reduce((sum, v) => sum + v.users, 0),
          checks: {
            srm: s.srm,
          },
          metrics: Array.from(metricIds).map((m) => {
            const metricName = getMetricName(m);
            return {
              metricId: m,
              ...(metricName ? { metricName } : null),
              variations: s.variations.map((v, i) => {
                const variationKey =
                  snapshot.settings.variations[i]?.id ?? `${i}`;
                const current =
                  currentVariationByKey.get(variationKey) ??
                  currentVariationById.get(variationKey);
                return {
                  variationIndex: i,
                  variationKey,
                  ...(current?.id ? { variationId: current.id } : null),
                  ...(current?.name ? { variationName: current.name } : null),
                  users: v.users,
                  analyses: sliceByNamePerAnalysis.map(
                    ({ analysis, sliceByName }) => {
                      const data = sliceByName.get(s.name)?.variations[i]
                        ?.metrics[m];
                      return toApiResultAnalysis(
                        analysis.settings.statsEngine || DEFAULT_STATS_ENGINE,
                        analysis.settings.differenceType,
                        data,
                      );
                    },
                  ),
                };
              }),
            };
          }),
        };
      }),
    });
  }

  return items;
}
