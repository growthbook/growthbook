import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { FactTableColumnType } from "shared/types/fact-table";
import React, {
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
} from "react";
import { OrganizationSettings } from "shared/types/organization";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { DifferenceType, StatsEngine } from "shared/types/stats";
import { Box, Flex, Separator } from "@radix-ui/themes";
import {
  expandMetricGroups,
  getAllMetricIdsFromExperiment,
  getAllExpandedMetricIdsFromExperiment,
  isFactMetric,
  isMetricJoinable,
  expandAllSliceMetricsInMap,
  ExperimentMetricDefinition,
  getLatestPhaseVariations,
  isDimensionPrecomputed,
  getExperimentOutdatedReasonLabel,
} from "shared/experiments";
import {
  isNewerOverallResultsDataAvailable,
  getIncrementalFullRefreshReasons,
  overallResultsBuiltWithoutIncrementalPipeline,
  OVERALL_NON_INCREMENTAL_FULL_REFRESH_REASON,
  IncrementalFullRefreshComparable,
} from "shared/enterprise";
import { getSnapshotAnalysis } from "shared/util";
import { MetricGroupInterface } from "shared/types/metric-groups";
import { getValidDate } from "shared/dates";
import {
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_POST_STRATIFICATION_ENABLED,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { startCase } from "lodash";
import { PiArrowSquareOut, PiCaretDownFill } from "react-icons/pi";
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
import Callout from "@/ui/Callout";
import {
  getIsExperimentIncludedInIncrementalRefresh,
  getPipelineSettingsAfterDisablingExperiment,
  getHonoredPrecomputedUnitDimensionIds,
} from "@/services/experiments";
import Metadata from "@/ui/Metadata";
import ResultsFilter from "@/components/Experiment/ResultsFilter/ResultsFilter";
import { filterMetricsByTags } from "@/hooks/useExperimentTableRows";
import DimensionChooser from "@/components/Dimensions/DimensionChooser";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import MigrateResultsToDashboardModal from "@/components/Experiment/ResultsFilter/MigrateResultsToDashboardModal";
import UpdateDimensionBreakdownModal from "@/components/Experiment/UpdateDimensionBreakdownModal";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
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
  dimensionSortBy?: "dimension-traffic" | "dimension-alpha" | null;
  setDimensionSortBy?: (
    s: "dimension-traffic" | "dimension-alpha" | null,
  ) => void;
  onSnapshotSuccessfulUpdate?: () => void;
}

const numberFormatter = Intl.NumberFormat();

export default function AnalysisSettingsSummary({
  experiment,
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
  dimensionSortBy,
  setDimensionSortBy,
  onSnapshotSuccessfulUpdate,
}: Props) {
  const {
    getDatasourceById,
    getExperimentMetricById,
    factTables,
    metricGroups,
    factMetrics,
    metrics,
    mutateDefinitions,
  } = useDefinitions();

  const datasourceSettings = experiment.datasource
    ? getDatasourceById(experiment.datasource)?.settings
    : undefined;
  const userIdType = datasourceSettings?.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId,
  )?.userIdType;

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

  const totalUnits = useMemo(() => {
    const healthVariationUnits =
      snapshot?.health?.traffic?.overall?.variationUnits;
    if (healthVariationUnits && healthVariationUnits.length > 0) {
      return healthVariationUnits.reduce((acc, a) => acc + a, 0);
    }
    // Fallback to using results for total units if health units not available
    let totalUsers = 0;
    analysis?.results?.forEach((result) => {
      result?.variations?.forEach((v) => (totalUsers += v?.users || 0));
    });
    return totalUsers;
  }, [analysis?.results, snapshot?.health?.traffic?.overall?.variationUnits]);

  // Convert userIdType to display name (e.g. "user_id" -> "User Ids")
  const unitDisplayName = userIdType
    ? startCase(userIdType.split("_").join(" ")) + "s"
    : "Units";

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
    // If dimensionless snapshto changes, re-fecth incremental refresh data
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

  const unjoinableMetrics = useMemo(() => {
    const unjoinables = new Set<string>();
    allExpandedMetrics.forEach((m) => {
      const metric = getExperimentMetricById(m);
      if (!metric) return;
      const userIdTypes = isFactMetric(metric)
        ? factTables.find((f) => f.id === metric.numerator.factTableId)
            ?.userIdTypes || []
        : metric.userIdTypes || [];
      const isJoinable =
        userIdType && datasourceSettings
          ? isMetricJoinable(userIdTypes, userIdType, datasourceSettings)
          : true;
      if (!isJoinable) {
        unjoinables.add(m);
      }
    });
    return unjoinables;
  }, [
    allExpandedMetrics,
    factTables,
    userIdType,
    datasourceSettings,
    getExperimentMetricById,
  ]);

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

  const { outdated, reasons } = isOutdated({
    experiment,
    snapshot,
    metricGroups,
    orgSettings,
    pValueThreshold,
    statsEngine,
    hasRegressionAdjustmentFeature,
    hasPostStratificationFeature,
    hasSequentialFeature,
    phase,
    unjoinableMetrics,
    conversionWindowMetrics,
    newerOverallResultsAvailable:
      newerOverallResultsAvailable && !incrementalUpdatesUnavailable,
  });

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

  function isDifferent(
    val1?: string | boolean | number | null,
    val2?: string | boolean | number | null,
  ) {
    if (!val1 && !val2) return false;
    return val1 !== val2;
  }

  function isDifferentStringArray(
    val1?: string[] | null,
    val2?: string[] | null,
  ) {
    if (!val1 && !val2) return false;
    if (!val1 || !val2) return true;
    if (val1.length !== val2.length) return true;
    return val1.some((v) => !val2.includes(v));
  }

  function isStringArrayMissingElements(
    strings: string[] = [],
    elements: string[] = [],
  ) {
    if (!elements.length) return false;
    if (elements.length > strings.length) return true;
    return elements.some((v) => !strings.includes(v));
  }

  function isDifferentDate(
    val1: Date,
    val2: Date,
    threshold: number = 86400000,
  ) {
    // 86400000 = 1 day
    return Math.abs(val1.getTime() - val2.getTime()) >= threshold;
  }

  function isOutdated({
    experiment: exp,
    snapshot: snap,
    metricGroups: mg = [],
    orgSettings: org,
    pValueThreshold: projectScopedPValueThreshold,
    statsEngine: engine,
    hasRegressionAdjustmentFeature,
    hasPostStratificationFeature,
    hasSequentialFeature,
    phase: currentPhase,
    unjoinableMetrics: unjoinable,
    conversionWindowMetrics: conversion,
    newerOverallResultsAvailable,
  }: {
    experiment?: ExperimentInterfaceStringDates;
    snapshot?: ExperimentSnapshotInterface;
    metricGroups?: MetricGroupInterface[];
    orgSettings: OrganizationSettings;
    pValueThreshold: number;
    statsEngine: StatsEngine;
    hasRegressionAdjustmentFeature: boolean;
    hasPostStratificationFeature: boolean;
    hasSequentialFeature: boolean;
    phase?: number;
    unjoinableMetrics?: Set<string>;
    conversionWindowMetrics?: Set<string>;
    newerOverallResultsAvailable?: boolean;
  }): { outdated: boolean; reasons: string[] } {
    const snapshotSettings = snap?.settings;
    const analysisSettings = snap ? getSnapshotAnalysis(snap)?.settings : null;
    if (!exp || !snapshotSettings || !analysisSettings) {
      return { outdated: false, reasons: [] };
    }

    const reasons: string[] = [];

    if (
      isDifferent(
        analysisSettings.statsEngine || DEFAULT_STATS_ENGINE,
        engine || DEFAULT_STATS_ENGINE,
      )
    ) {
      reasons.push("Stats engine changed");
    }
    if (isDifferent(exp.activationMetric, snapshotSettings.activationMetric)) {
      reasons.push(getExperimentOutdatedReasonLabel("activationMetric"));
    }
    if (isDifferent(exp.segment, snapshotSettings.segment)) {
      reasons.push(getExperimentOutdatedReasonLabel("segment"));
    }
    if (isDifferent(exp.queryFilter, snapshotSettings.queryFilter)) {
      reasons.push(getExperimentOutdatedReasonLabel("queryFilter"));
    }
    if (isDifferent(exp.skipPartialData, snapshotSettings.skipPartialData)) {
      reasons.push(getExperimentOutdatedReasonLabel("skipPartialData"));
    }
    if (isDifferent(exp.exposureQueryId, snapshotSettings.exposureQueryId)) {
      reasons.push(getExperimentOutdatedReasonLabel("exposureQueryId"));
    }
    if (
      isDifferent(
        exp.attributionModel || "firstExposure",
        snapshotSettings.attributionModel || "firstExposure",
      )
    ) {
      reasons.push(getExperimentOutdatedReasonLabel("attributionModel"));
    }

    const snapshotMetrics = Array.from(
      new Set(
        expandMetricGroups(
          getAllMetricIdsFromExperiment(snapshotSettings, false, mg),
          mg,
        ),
      ),
    ).filter((m) => (unjoinable ? !unjoinable.has(m) : true));

    let experimentMetrics = Array.from(
      new Set(
        expandMetricGroups(getAllMetricIdsFromExperiment(exp, false, mg), mg),
      ),
    ).filter((m) => (unjoinable ? !unjoinable.has(m) : true));

    if (exp.type === "holdout" && conversion?.size) {
      experimentMetrics = experimentMetrics.filter((m) => !conversion.has(m));
    }
    if (isStringArrayMissingElements(snapshotMetrics, experimentMetrics)) {
      reasons.push("Metrics changed");
    }

    if (
      isDifferentStringArray(
        getLatestPhaseVariations(exp).map((v) => v.key),
        snapshotSettings.variations.map((v) => v.id),
      )
    ) {
      reasons.push("Variations changed");
    }
    if (
      isDifferentDate(
        getValidDate(exp.phases?.[currentPhase ?? 0]?.dateStarted ?? ""),
        getValidDate(snapshotSettings.startDate),
      ) ||
      isDifferentDate(
        getValidDate(exp.phases?.[currentPhase ?? 0]?.dateEnded ?? ""),
        getValidDate(snapshotSettings.endDate),
      )
    ) {
      reasons.push("Analysis dates changed");
    }
    if (
      isDifferent(
        analysisSettings.pValueThreshold || DEFAULT_P_VALUE_THRESHOLD,
        projectScopedPValueThreshold || DEFAULT_P_VALUE_THRESHOLD,
      )
    ) {
      reasons.push("P-value threshold changed");
    }

    const experimentRegressionAdjustmentEnabled =
      !hasRegressionAdjustmentFeature
        ? false
        : !!exp.regressionAdjustmentEnabled;
    if (
      isDifferent(
        experimentRegressionAdjustmentEnabled,
        !!analysisSettings?.regressionAdjusted,
      )
    ) {
      reasons.push(
        getExperimentOutdatedReasonLabel("regressionAdjustmentEnabled"),
      );
    }

    const experimentPostStratificationEnabled =
      !hasPostStratificationFeature || org.disablePrecomputedDimensions
        ? false
        : (exp.postStratificationEnabled ??
          org.postStratificationEnabled ??
          DEFAULT_POST_STRATIFICATION_ENABLED);
    if (
      isDifferent(
        experimentPostStratificationEnabled,
        !!analysisSettings?.postStratificationEnabled,
      )
    ) {
      reasons.push("Post-stratification settings changed");
    }

    const experimentSequentialEnabled =
      engine !== "frequentist" || !hasSequentialFeature
        ? false
        : (exp.sequentialTestingEnabled ?? !!org.sequentialTestingEnabled);
    const experimentSequentialTuningParameter: number =
      exp.sequentialTestingTuningParameter ??
      org.sequentialTestingTuningParameter ??
      DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER;
    if (
      (isDifferent(
        experimentSequentialEnabled,
        !!analysisSettings?.sequentialTesting,
      ) ||
        (experimentSequentialEnabled &&
          experimentSequentialTuningParameter !==
            analysisSettings?.sequentialTestingTuningParameter)) &&
      engine === "frequentist"
    ) {
      reasons.push("Sequential testing settings changed");
    }

    // For incremental-refresh dimension breakdowns: the breakdown reads from
    // the overall results, so newer overall data makes it outdated too.
    if (newerOverallResultsAvailable) {
      reasons.push("Newer Overall Results are available");
    }

    return { outdated: reasons.length > 0, reasons };
  }

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
            {snapshot ? (
              <Metadata
                label={unitDisplayName}
                value={numberFormatter.format(totalUnits ?? 0)}
                style={{ whiteSpace: "nowrap" }}
              />
            ) : null}

            <Flex align="center" gap="2">
              <QueriesLastRun
                status={status}
                dateCreated={snapshot?.dateCreated}
                sourceSnapshot={sourceSnapshot}
                latestQueryDate={latest?.dateCreated}
                nextUpdate={experiment.nextSnapshotAttempt}
                autoUpdateEnabled={
                  experiment.autoSnapshots && !experiment.disableAutoSnapshots
                }
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
              {hasData &&
              outdated &&
              status !== "running" &&
              !hideOutdatedBadge ? (
                <OutdatedBadge
                  label={`These results are outdated. Click "Update" to re-run the analysis.`}
                  reasons={reasons}
                  hasData={hasData && hasValidStatsEngine}
                />
              ) : null}
            </Flex>

            {ds &&
            permissionsUtil.canRunExperimentQueries(ds) &&
            allMetrics.length > 0 ? (
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
                  viewingDimensionThatRequiresOverallFirst &&
                  overallResultsRequiredBeforeDimensionRefresh
                }
                fullRefreshRequired={
                  !viewingDimensionThatRequiresOverallFirst &&
                  overallNeedsFullRefresh
                }
                fullRefreshReasons={fullRefreshReasons}
              />
            ) : null}

            <ResultMoreMenu
              experiment={experiment}
              datasource={datasource}
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

                // Expand slice metrics and add them to the map
                expandAllSliceMetricsInMap({
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
                mutate={() => mutate({ inPlace: true })}
                setAnalysisSettings={setAnalysisSettings}
                setSnapshotDimension={setSnapshotDimension}
              />
            )}
            {setDimensionSortBy && (
              <>
                <Separator orientation="vertical" ml="3" mr="2" />
                <DropdownMenu
                  trigger={
                    <Link type="button">
                      <Text weight="semibold" color="text-high" size="small">
                        {dimensionSortBy === "dimension-alpha"
                          ? "Sort: A-Z"
                          : "Sort: Traffic"}
                      </Text>
                      <PiCaretDownFill />
                    </Link>
                  }
                >
                  <DropdownMenuItem
                    onClick={() => setDimensionSortBy(null)}
                    color={dimensionSortBy === null ? "default" : undefined}
                  >
                    Sort: Traffic
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setDimensionSortBy("dimension-alpha")}
                    color={
                      dimensionSortBy === "dimension-alpha"
                        ? "default"
                        : undefined
                    }
                  >
                    Sort: A-Z
                  </DropdownMenuItem>
                </DropdownMenu>
              </>
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

      {incrementalUpdatesUnavailable && (
        <Callout status="warning" mt="2">
          <Text weight="semibold" size="medium">
            Updates will rescan full experiment data.
          </Text>{" "}
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
        <Callout status="warning" mt="2">
          {overallNeedsFullRefresh ? (
            <>
              <Text weight="semibold" size="medium">
                Overall Results require a Full Refresh.
              </Text>{" "}
              Dimension Results are computed from Overall Results and would be
              inaccurate.{" "}
              <Link onClick={goToOverallResults}>
                Refresh Overall Results <PiArrowSquareOut size={15} />
              </Link>
            </>
          ) : (
            <>
              <Text weight="semibold" size="medium">
                Overall Results need to be run first.
              </Text>{" "}
              Dimension Results are computed from Overall Results.{" "}
              <Link onClick={goToOverallResults}>
                Run Overall Results <PiArrowSquareOut size={15} />
              </Link>
            </>
          )}
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
        <>
          <Callout status="error" mt="2">
            <strong>Error updating data: </strong> {refreshError}
          </Callout>
          {isExperimentIncludedInIncrementalRefresh && (
            <Box mt="2" mb="2">
              <Text size="small" color="text-low">
                If this error persists, you can try disabling Incremental
                Refresh for this experiment by{" "}
                <Link onClick={handleDisableIncrementalRefresh}>
                  clicking here
                </Link>
                .
              </Text>
            </Box>
          )}
        </>
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
