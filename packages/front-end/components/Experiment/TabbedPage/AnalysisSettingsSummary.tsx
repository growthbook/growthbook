import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { FactTableColumnType } from "shared/types/fact-table";
import React, {
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
} from "react";
import { DifferenceType, StatsEngine } from "shared/types/stats";
import { Box, Flex, Separator } from "@radix-ui/themes";
import {
  expandMetricGroups,
  getAllMetricIdsFromExperiment,
  getAllExpandedMetricIdsFromExperiment,
  expandDerivedMetricsInMap,
  ExperimentMetricDefinition,
  getLatestPhaseVariations,
  isDimensionPrecomputed,
  isAutoSnapshotScheduled,
  isExperimentResultsUpdateDisabled,
  EXPERIMENT_RESULTS_UPDATE_DISABLED_MESSAGE,
  getNewMetricsUpdate,
  getSnapshotDataAsOfDate,
  getResultsOutdatedReasons,
  getResultsOutdatedReasonLabel,
  getNewMetricsUpdateRefusal,
  getPlannedCopiedMetricSettings,
} from "shared/experiments";
import type { SnapshotQueryRunnerKind } from "shared/types/experiment-snapshot";
import {
  isNewerOverallResultsDataAvailable,
  getIncrementalFullRefreshReasons,
  overallResultsBuiltWithoutIncrementalPipeline,
  OVERALL_NON_INCREMENTAL_FULL_REFRESH_REASON,
  IncrementalFullRefreshComparable,
} from "shared/enterprise";
import {
  resolveAnalysisIdentifierType,
  getSnapshotCutoffDate,
} from "shared/util";
import { getValidDate } from "shared/dates";
import {
  DEFAULT_NEW_METRICS_UPDATE_WINDOW_HOURS,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { useDefinitions } from "@/services/DefinitionsContext";
import ResultMoreMenu, {
  shouldOfferMenuRefresh,
} from "@/components/Experiment/ResultMoreMenu";
import { useExperimentSnapshotUpdate } from "@/hooks/useExperimentSnapshotUpdate";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import { useIncrementalPipelineFallbackConfirm } from "@/hooks/useIncrementalPipelineFallbackConfirm";
import { useIncrementalRefresh } from "@/hooks/useIncrementalRefresh";
import { useUser } from "@/services/UserContext";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import RefreshResultsButton from "@/components/Experiment/RefreshResultsButton";
import IncrementalPipelineFallbackDialog from "@/components/Experiment/IncrementalPipelineFallbackDialog";
import FullRefreshRequiredDialog from "@/components/Experiment/FullRefreshRequiredDialog";
import MainSnapshotRefreshDialog from "@/components/Experiment/MainSnapshotRefreshDialog";
import QueriesLastRun from "@/components/Queries/QueriesLastRun";
import AsyncQueriesModal from "@/components/Queries/AsyncQueriesModal";
import OutdatedBadge from "@/components/OutdatedBadge";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import {
  getIsExperimentIncludedInIncrementalRefresh,
  getPipelineSettingsAfterDisablingExperiment,
  getHonoredPrecomputedUnitDimensionIds,
  getResultsSubUnitTotal,
  getUnitDisplayName,
  getUnjoinableMetricIds,
} from "@/services/experiments";
import Metadata from "@/ui/Metadata";
import Tooltip from "@/ui/Tooltip";
import ResultsFilter from "@/components/Experiment/ResultsFilter/ResultsFilter";
import { filterMetricsByTags } from "@/hooks/useExperimentTableRows";
import DimensionChooser from "@/components/Dimensions/DimensionChooser";
import Text from "@/ui/Text";
import MigrateResultsToDashboardModal from "@/components/Experiment/ResultsFilter/MigrateResultsToDashboardModal";
import UpdateDimensionBreakdownModal from "@/components/Experiment/UpdateDimensionBreakdownModal";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  // Added metrics a new-metrics update would compute.
  newMetricIds: readonly string[];
  mutate: () => void;
  statsEngine: StatsEngine;
  editMetrics?: () => void;
  variationFilter?: number[];
  baselineRow?: number;
  differenceType?: DifferenceType;
  dimension?: string;
  setDimension?: (dimension: string, resetOtherSettings?: boolean) => void;
  metricTagFilter?: string[];
  setMetricTagFilter?: (tags: string[]) => void;
  metricsFilter?: string[];
  setMetricsFilter?: (filters: string[]) => void;
  availableMetricsFilters?: {
    groups: Array<{ id: string; name: string }>;
    metrics: Array<{ id: string; name: string }>;
  };
  availableMetricTags?: string[];
  availableSliceTags?: Array<{
    id: string;
    datatypes: Record<string, FactTableColumnType>;
    isSelectAll?: boolean;
  }>;
  sliceTagsFilter?: string[];
  setSliceTagsFilter?: (tags: string[]) => void;
  sortBy?: "significance" | "change" | "custom" | null;
  sortDirection?: "asc" | "desc" | null;
  onSnapshotSuccessfulUpdate?: () => void;
}

const numberFormatter = Intl.NumberFormat();

export default function AnalysisSettingsSummary({
  experiment,
  newMetricIds,
  mutate: mutateExperiment,
  statsEngine,
  editMetrics,
  variationFilter,
  baselineRow,
  differenceType,
  dimension,
  setDimension,
  metricTagFilter,
  setMetricTagFilter,
  metricsFilter,
  setMetricsFilter,
  availableMetricsFilters = { groups: [], metrics: [] },
  availableMetricTags = [],
  availableSliceTags = [],
  sliceTagsFilter,
  setSliceTagsFilter,
  sortBy,
  sortDirection,
  onSnapshotSuccessfulUpdate,
}: Props) {
  const {
    getDatasourceById,
    getExperimentMetricById,
    getFactTableById,
    factTables,
    metricGroups,
    factMetrics,
    metrics,
    mutateDefinitions,
  } = useDefinitions();

  const datasourceSettings = experiment.datasource
    ? getDatasourceById(experiment.datasource)?.settings
    : undefined;
  const userIdType = resolveAnalysisIdentifierType(
    datasourceSettings?.queries?.exposure?.find(
      (e) => e.id === experiment.exposureQueryId,
    ),
    experiment.exposureQueryIdentifierType,
  );

  const orgSettings = useOrgSettings();
  const pValueThreshold = usePValueThreshold(experiment.project);
  const permissionsUtil = usePermissionsUtil();

  const { hasCommercialFeature } = useUser();
  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment",
  );
  const hasPostStratificationFeature = hasCommercialFeature(
    "post-stratification",
  );
  const hasSequentialFeature = hasCommercialFeature("sequential-testing");
  const hasMetricSlicesFeature = hasCommercialFeature("metric-slices");
  const hasPipelineModeFeature = hasCommercialFeature("pipeline-mode");

  const {
    snapshot,
    dimensionless,
    latestSummary: latest,
    analysis,
    dimension: _snapshotDimension,
    precomputedDimensions,
    sourceSnapshot,
    mutate,
    setAnalysisSettings,
    setSnapshotType,
    setDimension: setSnapshotDimension,
    phase,
  } = useSnapshot();

  // Track previous latest status to detect transition from "running" to "success"
  const previousLatestStatusRef = useRef<string | undefined>(latest?.status);

  // Call reset when latest status transitions from "running" to "success"
  useEffect(() => {
    if (
      previousLatestStatusRef.current === "running" &&
      latest?.status === "success"
    ) {
      onSnapshotSuccessfulUpdate?.();
    }
    previousLatestStatusRef.current = latest?.status;
  }, [latest?.status, onSnapshotSuccessfulUpdate]);

  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;
  const hasValidStatsEngine =
    !analysis?.settings ||
    (analysis?.settings?.statsEngine || DEFAULT_STATS_ENGINE) === statsEngine;

  const [refreshError, setRefreshError] = useState("");
  const [queriesModalOpen, setQueriesModalOpen] = useState(false);
  const [migrateToDashboardModalOpen, setMigrateToDashboardModalOpen] =
    useState(false);
  const [
    updateDimensionBreakdownModalOpen,
    setUpdateDimensionBreakdownModalOpen,
  ] = useState(false);

  const datasource = experiment
    ? getDatasourceById(experiment.datasource)
    : null;
  const phaseObj = experiment.phases?.[phase];
  const variations = getLatestPhaseVariations(experiment).map((v, i) => {
    return {
      id: v.key || v.index + "",
      index: v.index,
      name: v.name,
      weight: phaseObj?.variationWeights?.[i] || 0,
    };
  });

  const healthUnits = useMemo(() => {
    const healthVariationUnits =
      snapshot?.health?.traffic?.overall?.variationUnits;
    if (!healthVariationUnits?.length) return null;
    return healthVariationUnits.reduce((acc, a) => acc + a, 0);
  }, [snapshot?.health?.traffic?.overall?.variationUnits]);
  const resultsUnits = useMemo(() => {
    let totalUsers = 0;
    analysis?.results?.forEach((result) => {
      result?.variations?.forEach((v) => (totalUsers += v?.users || 0));
    });
    return totalUsers;
  }, [analysis?.results]);
  const totalUnits = healthUnits ?? resultsUnits;
  // A cluster's subunits can fall into several breakdown slices, so summing
  // slices would count it more than once. Use the overall results instead.
  const overallVariations = useMemo(
    () =>
      dimensionless?.analyses?.find((a) => !a.settings.dimensions.length)
        ?.results?.[0]?.variations ?? null,
    [dimensionless?.analyses],
  );
  const overallClusterUnits = useMemo(
    () =>
      overallVariations
        ? overallVariations.reduce((acc, v) => acc + (v?.users || 0), 0)
        : null,
    [overallVariations],
  );
  // From the overall snapshot too, so a breakdown keeps it. Without health
  // traffic, fall back to the metrics' own subunit counts.
  const overallSubUnits = useMemo(() => {
    const healthVariationUnits =
      dimensionless?.health?.traffic?.overall?.variationUnits;
    if (healthVariationUnits?.length) {
      return healthVariationUnits.reduce((acc, a) => acc + a, 0);
    }
    return overallVariations ? getResultsSubUnitTotal(overallVariations) : null;
  }, [
    dimensionless?.health?.traffic?.overall?.variationUnits,
    overallVariations,
  ]);

  // Cluster results are analyzed per cluster, so their unit counts are
  // clusters, while health traffic counts subunits.
  const clusterSubUnitIdentifier = snapshot?.settings?.isClusterExperiment
    ? snapshot.settings.clusterSubUnitIdentifier
    : undefined;
  const clusterIdentifier =
    snapshot?.settings?.exposureQueryIdentifierType ?? userIdType;

  const { apiCall } = useAuth();
  const { status } = getQueryStatus(latest?.queries || [], latest?.error);

  const {
    customValidation: confirmIncrementalPipelineFallback,
    reason: incrementalPipelineUnsupportedReason,
    isConfirmOpen: incrementalPipelineConfirmOpen,
    onConfirm: onConfirmIncrementalPipelineFallback,
    onCancel: onCancelIncrementalPipelineFallback,
  } = useIncrementalPipelineFallbackConfirm({
    experiment,
    latestStatus: latest?.status,
  });
  // When the next update would fall back to a full (non-incremental) rescan, the
  // incremental "dimension results are built on overall results" model no longer
  // holds. The stale-dimension modal and the "newer overall results" outdated
  // reason are both incremental-only concerns, so they don't apply here.
  const incrementalUpdatesUnavailable = !!incrementalPipelineUnsupportedReason;

  const isExperimentIncludedInIncrementalRefresh =
    getIsExperimentIncludedInIncrementalRefresh(
      datasource ?? undefined,
      experiment.id,
      experiment.type,
    );

  const isIncremental =
    isExperimentIncludedInIncrementalRefresh && !incrementalUpdatesUnavailable;

  const { incrementalRefresh, mutate: mutateIncrementalRefresh } =
    useIncrementalRefresh(isIncremental ? experiment.id : "");
  useEffect(() => {
    // If dimensionless snapshot changes, re-fetch incremental refresh data
    if (!isIncremental) return;
    mutateIncrementalRefresh();
  }, [isIncremental, dimensionless?.id, mutateIncrementalRefresh]);
  const honoredPrecomputedUnitDimensionIds = useMemo(
    () =>
      getHonoredPrecomputedUnitDimensionIds(
        experiment.precomputedUnitDimensionIds,
        datasource ?? undefined,
        hasPipelineModeFeature,
      ),
    [
      experiment.precomputedUnitDimensionIds,
      datasource,
      hasPipelineModeFeature,
    ],
  );
  const hasOverallResults = !!dimensionless && !dimensionless.dimension;
  // Overall-first rules apply only while incremental updates are active.
  const dimensionResultsUseOverallResults = isIncremental && !!dimension;

  const fullRefreshReasons: string[] = useMemo(() => {
    if (!isIncremental || !dimensionless || !hasOverallResults) return [];
    const phaseStart = experiment.phases?.[phase]?.dateStarted;
    const currentComparable: IncrementalFullRefreshComparable = {
      activationMetric: experiment.activationMetric ?? null,
      attributionModel: experiment.attributionModel ?? "firstExposure",
      queryFilter: experiment.queryFilter ?? "",
      segment: experiment.segment ?? "",
      skipPartialData: experiment.skipPartialData ?? false,
      datasourceId: experiment.datasource,
      exposureQueryId: experiment.exposureQueryId ?? "",
      exposureQueryIdentifierType: userIdType,
      isClusterExperiment: experiment.isClusterExperiment,
      clusterSubUnitIdentifier: experiment.clusterSubUnitIdentifier,
      // Match isOutdated's commercial-feature gate for regression adjustment.
      regressionAdjustmentEnabled: hasRegressionAdjustmentFeature
        ? !!experiment.regressionAdjustmentEnabled
        : false,
      experimentId: experiment.id,
      startDate: phaseStart
        ? new Date(phaseStart)
        : getValidDate(experiment.phases?.[0]?.dateStarted ?? ""),
    };
    const baselineComparable: IncrementalFullRefreshComparable = {
      activationMetric: dimensionless.settings.activationMetric,
      attributionModel: dimensionless.settings.attributionModel,
      queryFilter: dimensionless.settings.queryFilter,
      segment: dimensionless.settings.segment,
      skipPartialData: dimensionless.settings.skipPartialData,
      datasourceId: dimensionless.settings.datasourceId,
      exposureQueryId: dimensionless.settings.exposureQueryId,
      exposureQueryIdentifierType: resolveAnalysisIdentifierType(
        datasourceSettings?.queries?.exposure?.find(
          (e) => e.id === dimensionless.settings.exposureQueryId,
        ),
        dimensionless.settings.exposureQueryIdentifierType,
      ),
      isClusterExperiment: dimensionless.settings.isClusterExperiment,
      clusterSubUnitIdentifier: dimensionless.settings.clusterSubUnitIdentifier,
      regressionAdjustmentEnabled:
        dimensionless.settings.regressionAdjustmentEnabled,
      experimentId: dimensionless.settings.experimentId,
      startDate: dimensionless.settings.startDate,
    };
    const reasons = getIncrementalFullRefreshReasons(
      currentComparable,
      baselineComparable,
    );
    if (
      overallResultsBuiltWithoutIncrementalPipeline({
        unitsTableFullName: incrementalRefresh?.unitsTableFullName ?? null,
        materializedBySnapshotId: incrementalRefresh?.materializedBySnapshotId,
        latestOverallSnapshotId: dimensionless?.id ?? null,
      })
    ) {
      reasons.push(OVERALL_NON_INCREMENTAL_FULL_REFRESH_REASON);
    }
    return reasons;
  }, [
    isIncremental,
    dimensionless,
    hasOverallResults,
    experiment,
    phase,
    hasRegressionAdjustmentFeature,
    incrementalRefresh,
    userIdType,
    datasourceSettings,
  ]);

  const overallNeedsFullRefresh =
    isIncremental && fullRefreshReasons.length > 0;
  const overallNeverRanIncrementally =
    dimensionResultsUseOverallResults &&
    (!incrementalRefresh?.unitsTableFullName || !hasOverallResults);
  const dimensionIsPrecomputed = isDimensionPrecomputed(
    dimension,
    honoredPrecomputedUnitDimensionIds,
  );
  const viewingOnDemandDimension = !!dimension && !dimensionIsPrecomputed;
  const viewingDimensionThatRequiresOverallFirst =
    dimensionResultsUseOverallResults && viewingOnDemandDimension;
  const overallResultsRequiredBeforeDimensionRefresh =
    overallNeedsFullRefresh || overallNeverRanIncrementally;
  const hideOutdatedBadge =
    viewingDimensionThatRequiresOverallFirst && overallNeedsFullRefresh;
  // Org setting that freezes results (overall and dimension) of stopped
  // experiments once the grace period has elapsed. Custom reports stay open.
  const resultsUpdateDisabled = isExperimentResultsUpdateDisabled(
    experiment,
    orgSettings,
  );

  const newerOverallResultsAvailable = isNewerOverallResultsDataAvailable(
    sourceSnapshot,
    hasOverallResults ? dimensionless : undefined,
  );

  const [showMainRefreshModal, setShowMainRefreshModal] = useState(false);

  const handleSnapshotRefreshBlocked = () => {
    setShowMainRefreshModal(true);
  };

  const { runSnapshot, fullRefreshConfirm } = useExperimentSnapshotUpdate({
    experiment,
    phase,
    dimension,
    mutate,
    mutateAdditional: mutateExperiment,
    setRefreshError,
    onSnapshotRefreshBlocked: handleSnapshotRefreshBlocked,
  });

  const goToOverallResults = useCallback(() => {
    setSnapshotDimension("");
    setAnalysisSettings(null);
    setDimension?.("", true);
  }, [setSnapshotDimension, setAnalysisSettings, setDimension]);

  const updateMainResults = async () => {
    setShowMainRefreshModal(false);
    const started = await runSnapshot("", { force: true });
    if (!started) return;
    goToOverallResults();
    setSnapshotType?.(undefined);
  };

  const handleDisableIncrementalRefresh = async () => {
    if (!datasource || !isExperimentIncludedInIncrementalRefresh) return;

    const pipelineSettings = getPipelineSettingsAfterDisablingExperiment(
      datasource.settings.pipelineSettings,
      experiment.id,
    );

    await apiCall(`/datasource/${datasource.id}`, {
      method: "PUT",
      body: JSON.stringify({
        settings: {
          ...datasource.settings,
          pipelineSettings,
        },
      }),
    });
    setRefreshError("");
    mutateDefinitions();
  };

  const allExpandedMetrics = Array.from(
    new Set(
      expandMetricGroups(
        getAllMetricIdsFromExperiment(experiment, false, metricGroups),
        metricGroups,
      ),
    ),
  );

  const unjoinableMetrics = useMemo(
    () =>
      getUnjoinableMetricIds({
        metricIds: allExpandedMetrics,
        getExperimentMetricById,
        getFactTableById,
        userIdType,
        datasourceSettings,
      }),
    [
      allExpandedMetrics,
      getFactTableById,
      userIdType,
      datasourceSettings,
      getExperimentMetricById,
    ],
  );

  const conversionWindowMetrics = useMemo(() => {
    const conversionWindowMetrics = new Set<string>();
    allExpandedMetrics.forEach((m) => {
      const metric = getExperimentMetricById(m);
      if (!metric) return;
      if (metric?.windowSettings?.type === "conversion") {
        conversionWindowMetrics.add(m);
      }
    });
    return conversionWindowMetrics;
  }, [allExpandedMetrics, getExperimentMetricById]);

  const outdatedReasons = snapshot
    ? getResultsOutdatedReasons({
        experiment,
        snapshot,
        metricGroups,
        orgSettings,
        pValueThreshold,
        statsEngine,
        features: {
          regressionAdjustment: hasRegressionAdjustmentFeature,
          postStratification: hasPostStratificationFeature,
          sequentialTesting: hasSequentialFeature,
        },
        phase,
        exposureQueries: datasourceSettings?.queries?.exposure ?? [],
        unjoinableMetricIds: unjoinableMetrics,
        conversionWindowMetricIds: conversionWindowMetrics,
        newerOverallResultsAvailable:
          newerOverallResultsAvailable && !incrementalUpdatesUnavailable,
        resultsUpdateDisabled,
      })
    : [];
  const plannedCopiedMetricSettings = useMemo(
    () =>
      snapshot
        ? getPlannedCopiedMetricSettings({
            parentSettings: snapshot.settings,
            experiment,
            metricGroups,
            organizationSettings: orgSettings,
            getMetricById: getExperimentMetricById,
          })
        : null,
    [snapshot, experiment, metricGroups, orgSettings, getExperimentMetricById],
  );
  const fullRefreshRequired =
    !viewingDimensionThatRequiresOverallFirst && overallNeedsFullRefresh;
  // The run the back end would plan next. It rebuilds the Incremental
  // Pipeline's tables when their settings changed or there are none.
  const plannedRunnerKind: SnapshotQueryRunnerKind = !isIncremental
    ? "results"
    : overallNeedsFullRefresh || !incrementalRefresh?.unitsTableFullName
      ? "incremental-full"
      : "incremental-update";
  // When this holds, the split Update button stands in for the Outdated badge.
  // The back end builds on the latest successful standard Overall snapshot,
  // which this is when it's a standard one.
  const offerNewMetricsUpdate =
    !!snapshot &&
    !!plannedCopiedMetricSettings &&
    snapshot.type === "standard" &&
    newMetricIds.length > 0 &&
    hasData &&
    !dimension &&
    outdatedReasons.includes("metrics_changed") &&
    getNewMetricsUpdateRefusal({
      experiment,
      phase,
      separateExperimentResultQueries:
        !!datasource?.properties?.separateExperimentResultQueries,
      parent: snapshot,
      outdatedReasons,
      window: {
        windowHours:
          orgSettings.newMetricsUpdateWindowHours ??
          DEFAULT_NEW_METRICS_UPDATE_WINDOW_HOURS,
        now: new Date(),
      },
      planned: {
        runnerKind: plannedRunnerKind,
        settings: plannedCopiedMetricSettings,
      },
    }) === null;
  const snapshotNewMetricsUpdate = snapshot
    ? getNewMetricsUpdate(snapshot)
    : null;
  // A new-metrics update keeps its base's cutoff, where null means none.
  const snapshotCutoffDate = !snapshot
    ? null
    : snapshotNewMetricsUpdate
      ? snapshotNewMetricsUpdate.base.cutoffDate
      : getSnapshotCutoffDate(snapshot.settings);

  // If a dimension breakdown already covers the latest Overall Results, another
  // dimension update would read the same caches. Point the user to Overall
  // Results instead, where incremental updates can pull in newer data.
  const needsDimensionRefreshConfirm =
    !!sourceSnapshot &&
    !newerOverallResultsAvailable &&
    !incrementalUpdatesUnavailable;

  const confirmRefresh = useCallback(async (): Promise<boolean> => {
    if (needsDimensionRefreshConfirm) {
      setUpdateDimensionBreakdownModalOpen(true);
      return false;
    }
    return confirmIncrementalPipelineFallback();
  }, [needsDimensionRefreshConfirm, confirmIncrementalPipelineFallback]);

  const ds = getDatasourceById(experiment.datasource);

  const [showMetricFilter, setShowMetricFilter] = useState<boolean>(false);

  const { allMetrics, filteredMetrics } = useMemo(() => {
    const allMetricsArrays = [
      experiment.goalMetrics ?? [],
      experiment.secondaryMetrics ?? [],
      experiment.guardrailMetrics ?? [],
    ];

    const expandedGoals = expandMetricGroups(
      experiment.goalMetrics ?? [],
      metricGroups,
    );
    const expandedSecondaries = expandMetricGroups(
      experiment.secondaryMetrics ?? [],
      metricGroups,
    );
    const expandedGuardrails = expandMetricGroups(
      experiment.guardrailMetrics ?? [],
      metricGroups,
    );

    const allExpandedIds = [
      ...expandedGoals,
      ...expandedSecondaries,
      ...expandedGuardrails,
    ];
    const allMetricsMap = new Map<string, ExperimentMetricDefinition>();
    allExpandedIds.forEach((id) => {
      const metric = getExperimentMetricById(id);
      if (metric && !allMetricsMap.has(id)) {
        allMetricsMap.set(id, metric);
      }
    });
    const allMetrics = Array.from(allMetricsMap.values());

    const hasFilter = (metricsFilter?.length ?? 0) > 0;
    const groupsToUse = hasFilter
      ? metricGroups.filter((g) => metricsFilter!.includes(g.id))
      : metricGroups;

    // Create a set of allowed metric IDs from expanded groups and individual metrics
    const allowedMetricIds = hasFilter
      ? (() => {
          const allowed = new Set<string>();
          metricsFilter!.forEach((id) => {
            const group = metricGroups.find((g) => g.id === id);
            if (group) {
              group.metrics.forEach((metricId) => allowed.add(metricId));
            } else {
              allowed.add(id);
            }
          });
          return allowed;
        })()
      : null;

    const processMetrics = (metrics: string[]) => {
      let filtered = metrics;
      if (allowedMetricIds && metricsFilter) {
        filtered = filtered.filter(
          (id) => metricsFilter.includes(id) || allowedMetricIds.has(id),
        );
      }
      const expanded = expandMetricGroups(filtered, groupsToUse);
      const defs = expanded
        .map((id) => getExperimentMetricById(id))
        .filter((m): m is ExperimentMetricDefinition => !!m);
      return filterMetricsByTags(defs, metricTagFilter);
    };

    const filteredIds = allMetricsArrays.flatMap(processMetrics);
    const filteredMetricsMap = new Map<string, ExperimentMetricDefinition>();
    filteredIds.forEach((id) => {
      const metric = getExperimentMetricById(id);
      if (metric && !filteredMetricsMap.has(id)) {
        filteredMetricsMap.set(id, metric);
      }
    });
    const filteredMetrics = Array.from(filteredMetricsMap.values());

    return {
      allMetrics,
      filteredMetrics,
    };
  }, [
    experiment.goalMetrics,
    experiment.secondaryMetrics,
    experiment.guardrailMetrics,
    metricGroups,
    metricsFilter,
    metricTagFilter,
    getExperimentMetricById,
  ]);

  // Determine if any filters are currently set
  const hasActiveFilters =
    (metricTagFilter?.length || 0) > 0 ||
    (metricsFilter?.length || 0) > 0 ||
    (sliceTagsFilter?.length || 0) > 0;

  // Determine if any filter types are available/enabled
  const hasAvailableSlices =
    availableSliceTags.length > 0 && hasMetricSlicesFeature;
  const hasAvailableMetrics =
    availableMetricsFilters.groups.length > 0 ||
    availableMetricsFilters.metrics.length > 0;
  const hasAvailableTags = availableMetricTags.length > 0;

  const hasAnyAvailableFilter =
    hasAvailableSlices || hasAvailableMetrics || hasAvailableTags;

  // Render if filters are active OR at least one filter type is available
  const shouldRenderMetricFilter = hasActiveFilters || hasAnyAvailableFilter;

  return (
    <Box px="3" pt="3" mb="3">
      <Flex
        align="center"
        justify="between"
        gapX="6"
        gapY="2"
        pr="1"
        wrap="wrap-reverse"
      >
        <Box
          style={{
            flex: "1 0 auto",
            display: "flex",
            justifyContent: "flex-end",
            whiteSpace: "nowrap",
          }}
        >
          <Flex align="center" gap="4">
            {snapshot && clusterSubUnitIdentifier ? (
              <>
                {overallClusterUnits !== null && (
                  <Metadata
                    label={getUnitDisplayName(clusterIdentifier)}
                    value={numberFormatter.format(overallClusterUnits)}
                    style={{ whiteSpace: "nowrap" }}
                  />
                )}
                {overallSubUnits !== null && (
                  <Metadata
                    label={getUnitDisplayName(clusterSubUnitIdentifier)}
                    value={numberFormatter.format(overallSubUnits)}
                    style={{ whiteSpace: "nowrap" }}
                  />
                )}
              </>
            ) : snapshot ? (
              <Metadata
                label={getUnitDisplayName(userIdType)}
                value={numberFormatter.format(totalUnits)}
                style={{ whiteSpace: "nowrap" }}
              />
            ) : null}

            <Flex align="center" gap="2">
              <QueriesLastRun
                status={status}
                dateCreated={
                  snapshot ? getSnapshotDataAsOfDate(snapshot) : undefined
                }
                cutoffDate={snapshotCutoffDate}
                sourceSnapshot={sourceSnapshot}
                latestQueryDate={latest?.dateCreated}
                nextUpdate={experiment.nextSnapshotAttempt}
                autoUpdateEnabled={isAutoSnapshotScheduled(experiment)}
                showAutoUpdateWidget={true}
                failedString={
                  latest && !latest.queries.length && latest.error
                    ? `Snapshot update failed: ${latest.error}`
                    : undefined
                }
                queries={
                  latest &&
                  (status === "failed" || status === "partially-succeeded")
                    ? latest.queries.map((q) => q.query)
                    : undefined
                }
                onViewQueries={
                  latest &&
                  (status === "failed" || status === "partially-succeeded")
                    ? () => setQueriesModalOpen(true)
                    : undefined
                }
              />
              {!hasData ||
              status === "running" ||
              hideOutdatedBadge ||
              offerNewMetricsUpdate ? null : outdatedReasons.length > 0 ? (
                <OutdatedBadge
                  label={`These results are outdated. Click "Update" to re-run the analysis.`}
                  reasons={outdatedReasons.map(getResultsOutdatedReasonLabel)}
                  hasData={hasData && hasValidStatsEngine}
                />
              ) : null}
            </Flex>

            {ds &&
            permissionsUtil.canRunExperimentQueries(ds) &&
            allMetrics.length > 0 ? (
              <Tooltip
                content={EXPERIMENT_RESULTS_UPDATE_DISABLED_MESSAGE}
                enabled={resultsUpdateDisabled}
              >
                <Flex display="inline-flex">
                  <RefreshResultsButton
                    entityType={
                      experiment.type === "holdout" ? "holdout" : "experiment"
                    }
                    entityId={experiment.id}
                    datasourceId={experiment.datasource}
                    latest={latest}
                    experimentSnapshotTrackingProps={{
                      trackingSource: "RunQueriesButton",
                      datasourceType: datasource?.type || null,
                    }}
                    onSuccess={() => {
                      if (experiment.type === "multi-armed-bandit") {
                        setSnapshotType?.("exploratory");
                      } else {
                        setSnapshotType?.(undefined);
                      }
                    }}
                    // Poll loop + post-submit refresh hit the default
                    // status-only `mutate()` — the provider auto-upgrades to a
                    // full snapshot fetch when status reports a newer successful
                    // run, so a heavy refetch here would be redundant.
                    mutate={mutate}
                    mutateAdditional={mutateExperiment}
                    setRefreshError={setRefreshError}
                    experiment={experiment}
                    phase={phase}
                    dimension={dimension}
                    setAnalysisSettings={setAnalysisSettings}
                    customValidation={confirmRefresh}
                    onSnapshotRefreshBlocked={handleSnapshotRefreshBlocked}
                    disabled={
                      resultsUpdateDisabled ||
                      (viewingDimensionThatRequiresOverallFirst &&
                        overallResultsRequiredBeforeDimensionRefresh)
                    }
                    fullRefreshRequired={fullRefreshRequired}
                    fullRefreshReasons={fullRefreshReasons}
                    offerNewMetricsUpdate={offerNewMetricsUpdate}
                  />
                </Flex>
              </Tooltip>
            ) : null}

            <ResultMoreMenu
              experiment={experiment}
              datasource={datasource}
              forceRefreshDisabledReason={
                resultsUpdateDisabled
                  ? EXPERIMENT_RESULTS_UPDATE_DISABLED_MESSAGE
                  : undefined
              }
              forceRefresh={
                allMetrics.length > 0 &&
                shouldOfferMenuRefresh({
                  isIncremental,
                  dimension,
                  overallNeedsFullRefresh,
                })
                  ? async () => {
                      if (!(await confirmIncrementalPipelineFallback())) return;
                      await runSnapshot(dimension ?? "", {
                        force: true,
                        trackingSource: "ForceRerunQueriesButton",
                      });
                    }
                  : undefined
              }
              editMetrics={editMetrics}
              notebookUrl={`/experiments/notebook/${snapshot?.id}`}
              notebookFilename={experiment.trackingKey}
              supportsNotebooks={!!datasource?.settings?.notebookRunQuery}
              hasData={hasData}
              metrics={useMemo(() => {
                const metricMap = new Map<string, ExperimentMetricDefinition>();
                const allBaseMetrics = [...metrics, ...factMetrics];
                allBaseMetrics.forEach((metric) =>
                  metricMap.set(metric.id, metric),
                );
                const factTableMap = new Map(
                  factTables.map((table) => [table.id, table]),
                );

                // Expand derived metrics and add them to the map
                expandDerivedMetricsInMap({
                  metricMap,
                  factTableMap,
                  experiment,
                  metricGroups,
                });

                return getAllExpandedMetricIdsFromExperiment({
                  exp: experiment,
                  expandedMetricMap: metricMap,
                  includeActivationMetric: false,
                  metricGroups,
                });
              }, [experiment, metrics, factMetrics, factTables, metricGroups])}
              results={analysis?.results}
              variations={variations}
              trackingKey={experiment.trackingKey}
              dimension={dimension}
              project={experiment.project}
              onAddToDashboard={() => setMigrateToDashboardModalOpen(true)}
            />
          </Flex>
        </Box>

        <Box style={{ flex: "1 0 auto", order: -1, whiteSpace: "nowrap" }}>
          <Flex align="center">
            {setDimension && (
              <DimensionChooser
                value={dimension ?? ""}
                setValue={setDimension}
                precomputedDimensions={precomputedDimensions}
                activationMetric={!!experiment.activationMetric}
                datasourceId={experiment.datasource}
                exposureQueryId={experiment.exposureQueryId}
                userIdType={userIdType as "user" | "anonymous" | undefined}
                analysis={analysis}
                snapshot={snapshot}
                // DimensionChooser appends a new analysis to the existing
                // snapshot in place — pass `inPlace: true` so the heavy
                // fetch refreshes (the id-keyed auto-upgrade won't fire).
                mutate={() => mutate({ inPlace: true })}
                setAnalysisSettings={setAnalysisSettings}
                setSnapshotDimension={setSnapshotDimension}
              />
            )}
            {shouldRenderMetricFilter && (
              <>
                {setDimension && (
                  <Separator orientation="vertical" ml="5" mr="2" />
                )}
                <ResultsFilter
                  availableMetricTags={availableMetricTags}
                  metricTagFilter={metricTagFilter}
                  setMetricTagFilter={setMetricTagFilter}
                  availableMetricsFilters={availableMetricsFilters}
                  metricsFilter={metricsFilter}
                  setMetricsFilter={setMetricsFilter}
                  availableSliceTags={availableSliceTags}
                  sliceTagsFilter={sliceTagsFilter}
                  setSliceTagsFilter={setSliceTagsFilter}
                  showMetricFilter={showMetricFilter}
                  setShowMetricFilter={setShowMetricFilter}
                  dimension={dimension}
                />
              </>
            )}
          </Flex>
        </Box>
      </Flex>

      {filteredMetrics.length < allMetrics.length && (
        <Box mt="2">
          <Text>
            Showing {filteredMetrics.length} of {allMetrics.length} metrics
          </Text>
        </Box>
      )}

      {/* Gate on metrics so this warning only shows alongside the refresh
          button (same `allMetrics.length > 0` gate). With no metrics there is
          nothing to rescan, and Results already shows "Add at least 1 metric". */}
      {incrementalUpdatesUnavailable && allMetrics.length > 0 && (
        <Callout status="warning" contentAlign="center" mt="2">
          Updates will rescan the full experiment data.{" "}
          {incrementalPipelineUnsupportedReason}
        </Callout>
      )}

      {incrementalPipelineConfirmOpen &&
      incrementalPipelineUnsupportedReason ? (
        <IncrementalPipelineFallbackDialog
          reason={incrementalPipelineUnsupportedReason}
          onConfirm={onConfirmIncrementalPipelineFallback}
          onCancel={onCancelIncrementalPipelineFallback}
        />
      ) : null}

      <FullRefreshRequiredDialog controller={fullRefreshConfirm} />

      {viewingDimensionThatRequiresOverallFirst &&
      overallResultsRequiredBeforeDimensionRefresh ? (
        <Callout
          status="warning"
          contentAlign="center"
          mt="2"
          action={
            <Button variant="outline" size="sm" onClick={goToOverallResults}>
              {overallNeedsFullRefresh
                ? "Refresh overall results"
                : "Run overall results"}
            </Button>
          }
        >
          {overallNeedsFullRefresh
            ? "Overall results need a full refresh first. Dimension results are computed from them and would be inaccurate."
            : "Run overall results first. Dimension results are computed from them."}
        </Callout>
      ) : null}

      {showMainRefreshModal ? (
        <MainSnapshotRefreshDialog
          onConfirm={() =>
            updateMainResults().catch((e) => setRefreshError(e.message))
          }
          onCancel={() => setShowMainRefreshModal(false)}
        />
      ) : null}

      {refreshError && (
        <Callout
          status="error"
          contentAlign="center"
          mt="2"
          action={
            isExperimentIncludedInIncrementalRefresh ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisableIncrementalRefresh}
              >
                Disable incremental refresh
              </Button>
            ) : null
          }
        >
          Error updating data: {refreshError}
          {isExperimentIncludedInIncrementalRefresh
            ? " If it persists, try disabling incremental refresh for this experiment."
            : null}
        </Callout>
      )}
      {queriesModalOpen &&
        latest &&
        (status === "failed" || status === "partially-succeeded") && (
          <AsyncQueriesModal
            close={() => setQueriesModalOpen(false)}
            queries={latest.queries.map((q) => q.query)}
            savedQueries={[]}
            error={latest.error}
          />
        )}
      <MigrateResultsToDashboardModal
        open={migrateToDashboardModalOpen}
        close={() => setMigrateToDashboardModalOpen(false)}
        experiment={experiment}
        dimension={dimension}
        metricTagFilter={metricTagFilter}
        metricsFilter={metricsFilter}
        sliceTagsFilter={sliceTagsFilter}
        baselineRow={baselineRow}
        variationFilter={variationFilter}
        sortBy={sortBy ?? null}
        sortDirection={sortDirection ?? null}
        differenceType={differenceType}
      />
      {updateDimensionBreakdownModalOpen && sourceSnapshot && (
        <UpdateDimensionBreakdownModal
          sourceSnapshot={sourceSnapshot}
          close={() => setUpdateDimensionBreakdownModalOpen(false)}
          handleUpdateDimensionOnlyClick={async () => {
            await runSnapshot(dimension ?? "", {
              trackingSource: "UpdateDimensionBreakdownModal",
            });
          }}
          handleGoToOverallResultsClick={async () => {
            const started = await runSnapshot("", {
              trackingSource: "UpdateDimensionBreakdownModal",
            });
            if (!started) return;

            setUpdateDimensionBreakdownModalOpen(false);
            goToOverallResults();
          }}
        />
      )}
    </Box>
  );
}
