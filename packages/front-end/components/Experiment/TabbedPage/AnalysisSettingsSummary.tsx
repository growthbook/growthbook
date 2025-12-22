import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import React, { useMemo, useState } from "react";
import { OrganizationSettings } from "shared/types/organization";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { DifferenceType, StatsEngine } from "shared/types/stats";
import { Box, Flex, Text, Separator } from "@radix-ui/themes";
import {
  expandMetricGroups,
  getAllMetricIdsFromExperiment,
  getAllExpandedMetricIdsFromExperiment,
  isFactMetric,
  isMetricJoinable,
  expandAllSliceMetricsInMap,
  ExperimentMetricInterface,
} from "shared/experiments";
import { getSnapshotAnalysis } from "shared/util";
import { MetricGroupInterface } from "shared/types/metric-groups";
import { getValidDate } from "shared/dates";
import {
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { startCase } from "lodash";
import { useDefinitions } from "@/services/DefinitionsContext";
import ResultMoreMenu from "@/components/Experiment/ResultMoreMenu";
import { trackSnapshot } from "@/services/track";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import RefreshResultsButton from "@/components/Experiment/RefreshResultsButton";
import QueriesLastRun from "@/components/Queries/QueriesLastRun";
import AsyncQueriesModal from "@/components/Queries/AsyncQueriesModal";
import OutdatedBadge from "@/components/OutdatedBadge";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/ui/Callout";
import { getIsExperimentIncludedInIncrementalRefresh } from "@/services/experiments";
import Metadata from "@/ui/Metadata";
import ResultsMetricFilter from "@/components/Experiment/ResultsMetricFilter";
import { filterMetricsByTags } from "@/hooks/useExperimentTableRows";
import { useExperimentResultsFilters } from "@/hooks/useExperimentResultsFilters";
import DimensionChooser from "@/components/Dimensions/DimensionChooser";
import Link from "@/ui/Link";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  statsEngine: StatsEngine;
  editMetrics?: () => void;
  setVariationFilter?: (variationFilter: number[]) => void;
  baselineRow?: number;
  setBaselineRow?: (baselineRow: number) => void;
  setDifferenceType: (differenceType: DifferenceType) => void;
  dimension?: string;
  setDimension?: (dimension: string, resetOtherSettings?: boolean) => void;
}

const numberFormatter = Intl.NumberFormat();

export default function AnalysisSettingsSummary({
  experiment,
  mutate,
  statsEngine,
  editMetrics,
  baselineRow,
  setVariationFilter,
  setBaselineRow,
  setDifferenceType,
  dimension,
  setDimension,
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
  const permissionsUtil = usePermissionsUtil();

  const { hasCommercialFeature } = useUser();
  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment",
  );
  const hasSequentialFeature = hasCommercialFeature("sequential-testing");
  const hasMetricSlicesFeature = hasCommercialFeature("metric-slices");
  const hasMetricGroupsFeature = hasCommercialFeature("metric-groups");

  const {
    snapshot,
    latest,
    analysis,
    dimension: _snapshotDimension,
    precomputedDimensions,
    mutateSnapshot,
    setAnalysisSettings,
    setSnapshotType,
    setDimension: setSnapshotDimension,
    phase,
  } = useSnapshot();

  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;
  const [refreshError, setRefreshError] = useState("");
  const [queriesModalOpen, setQueriesModalOpen] = useState(false);

  const datasource = experiment
    ? getDatasourceById(experiment.datasource)
    : null;
  const phaseObj = experiment.phases?.[phase];
  const variations = experiment.variations.map((v, i) => {
    return {
      id: v.key || i + "",
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

  const isExperimentIncludedInIncrementalRefresh =
    getIsExperimentIncludedInIncrementalRefresh(
      datasource ?? undefined,
      experiment.id,
    );

  const handleDisableIncrementalRefresh = async () => {
    if (!datasource || !isExperimentIncludedInIncrementalRefresh) return;

    await apiCall(`/datasource/${datasource.id}`, {
      method: "PUT",
      body: JSON.stringify({
        settings: {
          ...datasource.settings,
          pipelineSettings: {
            ...datasource.settings.pipelineSettings,
            excludedExperimentIds: [
              ...(datasource.settings?.pipelineSettings
                ?.excludedExperimentIds ?? []),
              experiment.id,
            ],
          },
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
    statsEngine,
    hasRegressionAdjustmentFeature,
    hasSequentialFeature,
    phase,
    unjoinableMetrics,
    conversionWindowMetrics,
  });

  const ds = getDatasourceById(experiment.datasource);

  const [showMetricFilter, setShowMetricFilter] = useState<boolean>(false);

  const {
    availableMetricTags,
    availableMetricGroups,
    availableSliceTags,
    metricTagFilter,
    setMetricTagFilter,
    metricGroupsFilter,
    setMetricGroupsFilter,
    sliceTagsFilter,
    setSliceTagsFilter,
  } = useExperimentResultsFilters({
    experimentId: experiment.id,
    goalMetrics: experiment.goalMetrics,
    secondaryMetrics: experiment.secondaryMetrics,
    guardrailMetrics: experiment.guardrailMetrics,
    customMetricSlices: experiment.customMetricSlices,
  });

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
    const allMetricsMap = new Map<string, ExperimentMetricInterface>();
    allExpandedIds.forEach((id) => {
      const metric = getExperimentMetricById(id);
      if (metric && !allMetricsMap.has(id)) {
        allMetricsMap.set(id, metric);
      }
    });
    const allMetrics = Array.from(allMetricsMap.values());

    const hasGroupFilter = (metricGroupsFilter?.length ?? 0) > 0;
    const groupsToUse = hasGroupFilter
      ? metricGroups.filter((g) => metricGroupsFilter!.includes(g.id))
      : metricGroups;

    const allowedMetricIds = hasGroupFilter
      ? new Set(groupsToUse.flatMap((g) => g.metrics))
      : null;

    const processMetrics = (metrics: string[]) => {
      let filtered = metrics;
      if (allowedMetricIds && metricGroupsFilter) {
        filtered = filtered.filter(
          (id) => metricGroupsFilter.includes(id) || allowedMetricIds.has(id),
        );
      }
      const expanded = expandMetricGroups(filtered, groupsToUse);
      const defs = expanded
        .map((id) => getExperimentMetricById(id))
        .filter((m): m is ExperimentMetricInterface => !!m);
      return filterMetricsByTags(defs, metricTagFilter);
    };

    const filteredIds = allMetricsArrays.flatMap(processMetrics);
    const filteredMetricsMap = new Map<string, ExperimentMetricInterface>();
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
    metricGroupsFilter,
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
    statsEngine: engine,
    hasRegressionAdjustmentFeature,
    hasSequentialFeature,
    phase: currentPhase,
    unjoinableMetrics: unjoinable,
    conversionWindowMetrics: conversion,
  }: {
    experiment?: ExperimentInterfaceStringDates;
    snapshot?: ExperimentSnapshotInterface;
    metricGroups?: MetricGroupInterface[];
    orgSettings: OrganizationSettings;
    statsEngine: StatsEngine;
    hasRegressionAdjustmentFeature: boolean;
    hasSequentialFeature: boolean;
    phase?: number;
    unjoinableMetrics?: Set<string>;
    conversionWindowMetrics?: Set<string>;
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
      reasons.push("Activation metric changed");
    }
    if (isDifferent(exp.segment, snapshotSettings.segment)) {
      reasons.push("Segment changed");
    }
    if (isDifferent(exp.queryFilter, snapshotSettings.queryFilter)) {
      reasons.push("Query filter changed");
    }
    if (isDifferent(exp.skipPartialData, snapshotSettings.skipPartialData)) {
      reasons.push("In-progress conversion behavior changed");
    }
    if (isDifferent(exp.exposureQueryId, snapshotSettings.exposureQueryId)) {
      reasons.push("Experiment assignment query changed");
    }
    if (
      isDifferent(
        exp.attributionModel || "firstExposure",
        snapshotSettings.attributionModel || "firstExposure",
      )
    ) {
      reasons.push("Attribution model changed");
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
        exp.variations.map((v) => v.key),
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
        org.pValueThreshold || DEFAULT_P_VALUE_THRESHOLD,
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
      reasons.push("CUPED settings changed");
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

    return { outdated: reasons.length > 0, reasons };
  }

  // Determine if any filters are currently set
  const hasActiveFilters =
    (metricTagFilter?.length || 0) > 0 ||
    (metricGroupsFilter?.length || 0) > 0 ||
    (sliceTagsFilter?.length || 0) > 0;

  // Determine if any filter types are available/enabled
  const hasAvailableSlices =
    availableSliceTags.length > 0 && hasMetricSlicesFeature;
  const hasAvailableMetricGroups =
    availableMetricGroups.length > 0 && hasMetricGroupsFeature;
  const hasAvailableTags = availableMetricTags.length > 0;

  const hasAnyAvailableFilter =
    hasAvailableSlices || hasAvailableMetricGroups || hasAvailableTags;

  // Render if filters are active OR at least one filter type is available
  const shouldRenderMetricFilter = hasActiveFilters || hasAnyAvailableFilter;

  return (
    <Box px="3" pt="3" mb="2">
      <Flex align="center" justify="between" gap="6" pr="1">
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
              mutate={mutateSnapshot}
              setAnalysisSettings={setAnalysisSettings}
              setSnapshotDimension={setSnapshotDimension}
            />
          )}
          {shouldRenderMetricFilter && (
            <>
              {setDimension && (
                <Separator orientation="vertical" ml="5" mr="2" />
              )}
              <ResultsMetricFilter
                goalMetrics={experiment.goalMetrics}
                secondaryMetrics={experiment.secondaryMetrics}
                guardrailMetrics={experiment.guardrailMetrics}
                customMetricSlices={experiment.customMetricSlices}
                metricTagFilter={metricTagFilter}
                setMetricTagFilter={setMetricTagFilter}
                metricGroupsFilter={metricGroupsFilter}
                setMetricGroupsFilter={setMetricGroupsFilter}
                sliceTagsFilter={sliceTagsFilter}
                setSliceTagsFilter={setSliceTagsFilter}
                showMetricFilter={showMetricFilter}
                setShowMetricFilter={setShowMetricFilter}
                dimension={dimension}
              />
            </>
          )}
        </Flex>

        <Box style={{ flex: 1 }} />

        <Metadata
          label={unitDisplayName}
          value={numberFormatter.format(totalUnits ?? 0)}
        />

        <Flex align="center" gap="4">
          {hasData && (
            <Flex align="center" gap="2">
              <QueriesLastRun
                status={status}
                dateCreated={snapshot?.dateCreated}
                nextUpdate={experiment.nextSnapshotAttempt}
                autoUpdateEnabled={experiment.autoSnapshots}
                showAutoUpdateWidget={true}
                queries={
                  latest &&
                  (status === "failed" || status === "partially-succeeded")
                    ? latest.queries.map((q) => q.query)
                    : undefined
                }
                onViewQueries={
                  latest &&
                  ds &&
                  permissionsUtil.canRunExperimentQueries(ds) &&
                  (status === "failed" || status === "partially-succeeded")
                    ? () => setQueriesModalOpen(true)
                    : undefined
                }
              />
              {outdated && status !== "running" ? (
                <OutdatedBadge
                  label={`Analysis settings have changed since last run. Click "Update" to re-run the analysis.`}
                  reasons={reasons}
                />
              ) : null}
            </Flex>
          )}

          {(!ds || permissionsUtil.canRunExperimentQueries(ds)) &&
            allMetrics.length > 0 && (
              <RefreshResultsButton
                entityType={
                  experiment.type === "holdout" ? "holdout" : "experiment"
                }
                entityId={experiment.id}
                datasourceId={experiment.datasource}
                latest={latest}
                onSubmitSuccess={(snapshot) => {
                  trackSnapshot(
                    "create",
                    "RunQueriesButton",
                    datasource?.type || null,
                    snapshot,
                  );
                  setAnalysisSettings(null);
                }}
                mutate={mutateSnapshot}
                mutateAdditional={mutate}
                setRefreshError={setRefreshError}
                resetFilters={async () => {
                  if (baselineRow !== 0) {
                    setBaselineRow?.(0);
                    setVariationFilter?.([]);
                  }
                  setDifferenceType("relative");
                  if (experiment.type === "multi-armed-bandit") {
                    setSnapshotType?.("exploratory");
                  } else {
                    setSnapshotType?.(undefined);
                  }
                }}
                experiment={experiment}
                analysis={analysis}
                phase={phase}
                dimension={dimension}
                setAnalysisSettings={setAnalysisSettings}
              />
            )}

          <ResultMoreMenu
            experiment={experiment}
            datasource={datasource}
            forceRefresh={
              allMetrics.length > 0
                ? async () => {
                    await apiCall<{
                      snapshot: ExperimentSnapshotInterface;
                    }>(`/experiment/${experiment.id}/snapshot?force=true`, {
                      method: "POST",
                      body: JSON.stringify({
                        phase,
                        dimension,
                      }),
                    })
                      .then((res) => {
                        setAnalysisSettings(null);
                        if (baselineRow !== 0) {
                          setBaselineRow?.(0);
                          setVariationFilter?.([]);
                        }
                        setDifferenceType("relative");
                        trackSnapshot(
                          "create",
                          "ForceRerunQueriesButton",
                          datasource?.type || null,
                          res.snapshot,
                        );
                        mutateSnapshot();
                        mutate();
                        setRefreshError("");
                      })
                      .catch((e) => {
                        console.error(e);
                        setRefreshError(e.message);
                      });
                  }
                : undefined
            }
            editMetrics={editMetrics}
            notebookUrl={`/experiments/notebook/${snapshot?.id}`}
            notebookFilename={experiment.trackingKey}
            queries={
              latest && latest.status !== "error" && latest.queries
                ? latest.queries
                : snapshot?.queries
            }
            queryError={snapshot?.error}
            supportsNotebooks={!!datasource?.settings?.notebookRunQuery}
            hasData={hasData}
            metrics={useMemo(() => {
              const metricMap = new Map<string, ExperimentMetricInterface>();
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
          />
        </Flex>
      </Flex>

      {filteredMetrics.length < allMetrics.length && (
        <Box mt="2">
          <Text>
            Showing {filteredMetrics.length} of {allMetrics.length} metrics
          </Text>
        </Box>
      )}

      {refreshError && (
        <>
          <Callout status="error" mt="2">
            <strong>Error updating data: </strong> {refreshError}
          </Callout>
          {isExperimentIncludedInIncrementalRefresh && (
            <Box mt="2" mb="2" style={{ color: "var(--color-text-low)" }}>
              <Text size="1">
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
    </Box>
  );
}
