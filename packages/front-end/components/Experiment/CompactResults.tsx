import { FC, useMemo, useState } from "react";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
  MetricSnapshotSettings,
} from "back-end/types/report";
import {
  ExperimentStatus,
  ExperimentType,
  MetricOverride,
} from "back-end/types/experiment";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "back-end/types/stats";
import { FaAngleRight, FaUsers } from "react-icons/fa";
import {
  PiCaretCircleRight,
  PiCaretCircleDown,
  PiPushPinFill,
} from "react-icons/pi";
import Collapsible from "react-collapsible";
import {
  expandMetricGroups,
  ExperimentMetricInterface,
  generatePinnedDimensionKey,
  setAdjustedCIs,
  setAdjustedPValuesOnResults,
} from "shared/experiments";
import { isDefined } from "shared/util";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { HiBadgeCheck } from "react-icons/hi";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  applyMetricOverrides,
  ExperimentTableRow,
} from "@/services/experiments";
import { QueryStatusData } from "@/components/Queries/RunQueriesButton";
import {
  ResultsMetricFilters,
  sortAndFilterMetricsByTags,
} from "@/components/Experiment/Results";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import Tooltip from "@/components/Tooltip/Tooltip";
import MetricTooltipBody from "@/components/Metrics/MetricTooltipBody";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useUser } from "@/services/UserContext";
import { AppFeatures } from "@/types/app-features";
import DataQualityWarning from "./DataQualityWarning";
import ResultsTable from "./ResultsTable";
import MultipleExposureWarning from "./MultipleExposureWarning";
import VariationUsersTable from "./TabbedPage/VariationUsersTable";
import { ExperimentTab } from "./TabbedPage";

const numberFormatter = Intl.NumberFormat();

const CompactResults: FC<{
  experimentId: string;
  editMetrics?: () => void;
  variations: ExperimentReportVariation[];
  variationFilter?: number[];
  baselineRow?: number;
  multipleExposures?: number;
  results: ExperimentReportResultDimension;
  queryStatusData?: QueryStatusData;
  reportDate: Date;
  startDate: string;
  endDate: string;
  isLatestPhase: boolean;
  phase: number;
  status: ExperimentStatus;
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  metricOverrides: MetricOverride[];
  id: string;
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  regressionAdjustmentEnabled?: boolean;
  settingsForSnapshotMetrics?: MetricSnapshotSettings[];
  sequentialTestingEnabled?: boolean;
  differenceType: DifferenceType;
  metricFilter?: ResultsMetricFilters;
  setMetricFilter?: (filter: ResultsMetricFilters) => void;
  isTabActive: boolean;
  setTab?: (tab: ExperimentTab) => void;
  mainTableOnly?: boolean;
  noStickyHeader?: boolean;
  noTooltip?: boolean;
  experimentType?: ExperimentType;
  ssrPolyfills?: SSRPolyfills;
  hideDetails?: boolean;
  disableTimeSeriesButton?: boolean;
  pinnedMetricDimensionLevels?: string[];
  togglePinnedMetricDimensionLevel?: (
    metricId: string,
    dimensionLevels: Array<{ column: string; levels: string[] }>,
    location?: "goal" | "secondary" | "guardrail",
  ) => void;
  customMetricDimensionLevels?: Array<{
    dimensionLevels: Array<{
      dimension: string;
      levels: string[];
    }>;
  }>;
}> = ({
  experimentId,
  editMetrics,
  variations,
  variationFilter,
  baselineRow = 0,
  multipleExposures = 0,
  results,
  queryStatusData,
  reportDate,
  startDate,
  endDate,
  isLatestPhase,
  phase,
  status,
  goalMetrics,
  guardrailMetrics,
  secondaryMetrics,
  metricOverrides,
  id,
  statsEngine,
  pValueCorrection,
  regressionAdjustmentEnabled,
  settingsForSnapshotMetrics,
  sequentialTestingEnabled,
  differenceType,
  metricFilter,
  setMetricFilter,
  isTabActive,
  setTab,
  mainTableOnly,
  noStickyHeader,
  noTooltip,
  experimentType,
  ssrPolyfills,
  hideDetails,
  disableTimeSeriesButton,
  pinnedMetricDimensionLevels,
  togglePinnedMetricDimensionLevel,
  customMetricDimensionLevels,
}) => {
  const {
    getExperimentMetricById,
    getFactMetricDimensions,
    metricGroups,
    ready,
  } = useDefinitions();
  const { hasCommercialFeature } = useUser();
  const growthbook = useGrowthBook<AppFeatures>();

  // Feature flag and commercial feature checks for dimension analysis
  const isMetricDimensionsFeatureEnabled =
    growthbook?.isOn("metric-dimensions");
  const hasMetricDimensionsFeature = hasCommercialFeature("metric-dimensions");
  const shouldShowMetricDimensions =
    isMetricDimensionsFeatureEnabled && hasMetricDimensionsFeature;

  const _pValueThreshold = usePValueThreshold();
  const pValueThreshold =
    ssrPolyfills?.usePValueThreshold() || _pValueThreshold;

  const [expandedMetrics, setExpandedMetrics] = useState<
    Record<string, boolean>
  >({});
  const toggleExpandedMetric = (
    metricId: string,
    resultGroup: "goal" | "secondary" | "guardrail",
  ) => {
    const key = `${metricId}:${resultGroup}`;
    setExpandedMetrics((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const [totalUsers, variationUsers] = useMemo(() => {
    let totalUsers = 0;
    const variationUsers: number[] = [];
    results?.variations?.forEach((v, i) => {
      totalUsers += v.users;
      variationUsers[i] = variationUsers[i] || 0;
      variationUsers[i] += v.users;
    });
    return [totalUsers, variationUsers];
  }, [results]);

  const { expandedGoals, expandedSecondaries, expandedGuardrails } =
    useMemo(() => {
      const expandedGoals = expandMetricGroups(
        goalMetrics,
        ssrPolyfills?.metricGroups || metricGroups,
      );
      const expandedSecondaries = expandMetricGroups(
        secondaryMetrics,
        ssrPolyfills?.metricGroups || metricGroups,
      );
      const expandedGuardrails = expandMetricGroups(
        guardrailMetrics,
        ssrPolyfills?.metricGroups || metricGroups,
      );

      return { expandedGoals, expandedSecondaries, expandedGuardrails };
    }, [
      goalMetrics,
      metricGroups,
      ssrPolyfills?.metricGroups,
      secondaryMetrics,
      guardrailMetrics,
    ]);

  const allMetricTags = useMemo(() => {
    const allMetricTagsSet: Set<string> = new Set();
    [...expandedGoals, ...expandedSecondaries, ...expandedGuardrails].forEach(
      (metricId) => {
        const metric =
          ssrPolyfills?.getExperimentMetricById?.(metricId) ||
          getExperimentMetricById(metricId);
        metric?.tags?.forEach((tag) => {
          allMetricTagsSet.add(tag);
        });
      },
    );
    return [...allMetricTagsSet];
  }, [
    expandedGoals,
    expandedSecondaries,
    expandedGuardrails,
    ssrPolyfills,
    getExperimentMetricById,
  ]);

  const rows = useMemo<ExperimentTableRow[]>(() => {
    function getRow(
      metricId: string,
      resultGroup: "goal" | "secondary" | "guardrail",
    ): ExperimentTableRow[] {
      const metric =
        ssrPolyfills?.getExperimentMetricById?.(metricId) ||
        getExperimentMetricById(metricId);
      if (!metric) return [];
      const { newMetric, overrideFields } = applyMetricOverrides(
        metric,
        metricOverrides,
      );
      let metricSnapshotSettings: MetricSnapshotSettings | undefined;
      if (settingsForSnapshotMetrics) {
        metricSnapshotSettings = settingsForSnapshotMetrics.find(
          (s) => s.metric === metricId,
        );
      }
      // Get dimension count for this metric (only if feature is enabled)
      const standardDimensions =
        ssrPolyfills?.getFactMetricDimensions?.(metricId)?.length ||
        getFactMetricDimensions?.(metricId)?.length ||
        0;

      const customDimensions = customMetricDimensionLevels?.length || 0;

      const numDimensions = shouldShowMetricDimensions
        ? standardDimensions + customDimensions
        : 0;

      const parentRow: ExperimentTableRow = {
        label: newMetric?.name,
        metric: newMetric,
        metricOverrideFields: overrideFields,
        rowClass: newMetric?.inverse ? "inverse" : "",
        variations: results.variations.map((v) => {
          return (
            v.metrics?.[metricId] || {
              users: 0,
              value: 0,
              cr: 0,
              errorMessage: "No data",
            }
          );
        }),
        metricSnapshotSettings,
        resultGroup,
        numDimensions,
      };

      const rows: ExperimentTableRow[] = [parentRow];

      // Add dimension rows if this metric has dimensions and feature is enabled
      if (numDimensions > 0 && shouldShowMetricDimensions) {
        const standardDimensionData =
          ssrPolyfills?.getFactMetricDimensions?.(metricId) ||
          getFactMetricDimensions?.(metricId) ||
          [];

        // Convert custom dimension levels to dimension data format
        const customDimensionData =
          customMetricDimensionLevels?.map((group) => {
            // Sort dimensions alphabetically for consistent ID generation
            const sortedDimensions = group.dimensionLevels.sort((a, b) =>
              a.dimension.localeCompare(b.dimension),
            );
            const dimensionString = sortedDimensions
              .map(
                (combo) =>
                  `dim:${encodeURIComponent(combo.dimension)}=${encodeURIComponent(combo.levels[0] || "")}`,
              )
              .join("&");

            return {
              id: `${metricId}?${dimensionString}`,
              name: `${newMetric?.name} (${sortedDimensions.map((combo) => `${combo.dimension}: ${combo.levels[0] || ""}`).join(", ")})`,
              description: `Custom dimensional analysis of ${newMetric?.name} for ${sortedDimensions.map((combo) => `${combo.dimension} = ${combo.levels[0] || ""}`).join(" and ")}`,
              parentMetricId: metricId,
              dimensionLevels: sortedDimensions.map((combo) => ({
                column: combo.dimension,
                columnName: combo.dimension,
                level: combo.levels[0] || null,
              })),
              allDimensionLevels: [],
            };
          }) || [];

        const dimensionData = [
          ...standardDimensionData,
          ...customDimensionData,
        ];

        dimensionData.forEach((dimension) => {
          const expandedKey = `${metricId}:${resultGroup}`;
          const isExpanded = expandedMetrics[expandedKey] || false;

          // Generate pinned key from all dimension levels
          const pinnedDimensionLevels = dimension.dimensionLevels.map((dl) => ({
            column: dl.column,
            levels: dl.level ? [dl.level] : [],
          }));
          const pinnedKey = generatePinnedDimensionKey(
            metricId,
            pinnedDimensionLevels,
            resultGroup,
          );
          const isPinned =
            pinnedMetricDimensionLevels?.includes(pinnedKey) || false;

          // Show level if metric is expanded OR if it's pinned
          const shouldShowLevel = isExpanded || isPinned;

          // Generate label from dimension levels
          const label = dimension.dimensionLevels
            .map((dl) => dl.level || "other")
            .join(" + ");

          const dimensionRow: ExperimentTableRow = {
            label,
            metric: {
              ...newMetric,
              name: dimension.name, // Use the full dimension metric name
            },
            metricOverrideFields: overrideFields,
            rowClass: `${newMetric?.inverse ? "inverse" : ""} dimension-row`,
            variations: results.variations.map((v) => {
              // Use the dimension metric's data instead of the parent metric's data
              return (
                v.metrics?.[dimension.id] || {
                  users: 0,
                  value: 0,
                  cr: 0,
                  errorMessage: "No data",
                }
              );
            }),
            metricSnapshotSettings,
            resultGroup,
            numDimensions: 0, // Dimension rows don't have their own dimensions
            isDimensionRow: true,
            parentRowId: metricId,
            dimensionLevels: dimension.dimensionLevels,
            allDimensionLevels: dimension.allDimensionLevels,
            isHiddenByFilter: !shouldShowLevel, // Add this property to indicate if row should be hidden
            isPinned: isPinned,
          };

          // Always add dimension rows to the array, even if hidden by filter
          // Skip "other" dimension rows with no data
          if (
            dimension.dimensionLevels.every((dl) => dl.level === null) &&
            dimensionRow.variations.every((v) => v.value === 0)
          ) {
            return;
          }
          rows.push(dimensionRow);
          console.log("DIMENSION ROW", dimensionRow);
        });
      }

      return rows;
    }

    if (!results || !results.variations || (!ready && !ssrPolyfills)) return [];
    if (pValueCorrection && statsEngine === "frequentist") {
      // Only include goals in calculation, not secondary or guardrails
      setAdjustedPValuesOnResults([results], expandedGoals, pValueCorrection);
      setAdjustedCIs([results], pValueThreshold);
    }

    const metricDefs = expandedGoals
      .map(
        (metricId) =>
          ssrPolyfills?.getExperimentMetricById?.(metricId) ||
          getExperimentMetricById(metricId),
      )
      .filter(isDefined);
    const sortedFilteredMetrics = sortAndFilterMetricsByTags(
      metricDefs,
      metricFilter,
    );

    const secondaryDefs = expandedSecondaries
      .map(
        (metricId) =>
          ssrPolyfills?.getExperimentMetricById?.(metricId) ||
          getExperimentMetricById(metricId),
      )
      .filter(isDefined);
    const sortedFilteredSecondary = sortAndFilterMetricsByTags(
      secondaryDefs,
      metricFilter,
    );

    const guardrailDefs = expandedGuardrails
      .map(
        (metricId) =>
          ssrPolyfills?.getExperimentMetricById?.(metricId) ||
          getExperimentMetricById(metricId),
      )
      .filter(isDefined);
    const sortedFilteredGuardrails = sortAndFilterMetricsByTags(
      guardrailDefs,
      metricFilter,
    );

    const retMetrics = sortedFilteredMetrics.flatMap((metricId) =>
      getRow(metricId, "goal"),
    );
    const retSecondary = sortedFilteredSecondary.flatMap((metricId) =>
      getRow(metricId, "secondary"),
    );
    const retGuardrails = sortedFilteredGuardrails.flatMap((metricId) =>
      getRow(metricId, "guardrail"),
    );
    return [...retMetrics, ...retSecondary, ...retGuardrails];
  }, [
    results,
    expandedGoals,
    expandedSecondaries,
    expandedGuardrails,
    metricOverrides,
    settingsForSnapshotMetrics,
    pValueCorrection,
    pValueThreshold,
    statsEngine,
    ready,
    ssrPolyfills,
    getExperimentMetricById,
    metricFilter,
    pinnedMetricDimensionLevels,
    expandedMetrics,
    getFactMetricDimensions,
    shouldShowMetricDimensions,
    customMetricDimensionLevels,
  ]);

  const isBandit = experimentType === "multi-armed-bandit";

  return (
    <>
      {!mainTableOnly && (
        <>
          {!isBandit && status !== "draft" && totalUsers > 0 && (
            <div className="users">
              <Collapsible
                trigger={
                  <div className="d-inline-flex mx-3 align-items-center">
                    <FaUsers size={16} className="mr-1" />
                    {numberFormatter.format(totalUsers)} total units
                    <FaAngleRight className="chevron ml-1" />
                  </div>
                }
                transitionTime={100}
              >
                <div style={{ maxWidth: "800px" }}>
                  <VariationUsersTable
                    variations={variations}
                    users={variationUsers}
                    srm={results.srm}
                  />
                </div>
              </Collapsible>
            </div>
          )}

          <div className="mx-3">
            {experimentType !== "multi-armed-bandit" && (
              <DataQualityWarning
                results={results}
                variations={variations}
                linkToHealthTab
                setTab={setTab}
                isBandit={isBandit}
              />
            )}
            <MultipleExposureWarning
              totalUsers={totalUsers}
              multipleExposures={multipleExposures}
            />
          </div>
        </>
      )}

      {expandedGoals.length ? (
        <ResultsTable
          experimentId={experimentId}
          dateCreated={reportDate}
          isLatestPhase={isLatestPhase}
          phase={phase}
          startDate={startDate}
          endDate={endDate}
          status={status}
          queryStatusData={queryStatusData}
          variations={variations}
          variationFilter={variationFilter}
          baselineRow={baselineRow}
          rows={rows.filter((r) => r.resultGroup === "goal")}
          id={id}
          resultGroup="goal"
          tableRowAxis="metric"
          labelHeader={
            experimentType !== "multi-armed-bandit"
              ? "Goal Metrics"
              : "Decision Metric"
          }
          editMetrics={
            experimentType !== "multi-armed-bandit" ? editMetrics : undefined
          }
          statsEngine={statsEngine}
          sequentialTestingEnabled={sequentialTestingEnabled}
          pValueCorrection={pValueCorrection}
          differenceType={differenceType}
          renderLabelColumn={getRenderLabelColumn({
            regressionAdjustmentEnabled,
            statsEngine,
            hideDetails,
            experimentType,
            pinnedMetricDimensionLevels,
            togglePinnedMetricDimensionLevel,
            expandedMetrics,
            toggleExpandedMetric,
            getFactMetricDimensions,
            ssrPolyfills,
            shouldShowMetricDimensions,
          })}
          metricFilter={
            experimentType !== "multi-armed-bandit" ? metricFilter : undefined
          }
          setMetricFilter={
            experimentType !== "multi-armed-bandit"
              ? setMetricFilter
              : undefined
          }
          metricTags={allMetricTags}
          isTabActive={isTabActive}
          noStickyHeader={noStickyHeader}
          noTooltip={noTooltip}
          isBandit={isBandit}
          isGoalMetrics={true}
          ssrPolyfills={ssrPolyfills}
          disableTimeSeriesButton={disableTimeSeriesButton}
          isHoldout={experimentType === "holdout"}
        />
      ) : null}

      {!mainTableOnly && expandedSecondaries.length ? (
        <div className="mt-4">
          <ResultsTable
            experimentId={experimentId}
            dateCreated={reportDate}
            isLatestPhase={isLatestPhase}
            phase={phase}
            startDate={startDate}
            endDate={endDate}
            status={status}
            queryStatusData={queryStatusData}
            variations={variations}
            variationFilter={variationFilter}
            baselineRow={baselineRow}
            rows={rows.filter((r) => r.resultGroup === "secondary")}
            id={id}
            resultGroup="secondary"
            tableRowAxis="metric"
            labelHeader="Secondary Metrics"
            editMetrics={editMetrics}
            statsEngine={statsEngine}
            sequentialTestingEnabled={sequentialTestingEnabled}
            pValueCorrection={pValueCorrection}
            differenceType={differenceType}
            renderLabelColumn={getRenderLabelColumn({
              regressionAdjustmentEnabled,
              statsEngine,
              hideDetails,
              experimentType: undefined,
              pinnedMetricDimensionLevels,
              togglePinnedMetricDimensionLevel,
              expandedMetrics,
              toggleExpandedMetric,
              getFactMetricDimensions,
              ssrPolyfills,
              shouldShowMetricDimensions,
            })}
            metricFilter={metricFilter}
            setMetricFilter={setMetricFilter}
            metricTags={allMetricTags}
            isTabActive={isTabActive}
            noStickyHeader={noStickyHeader}
            noTooltip={noTooltip}
            isBandit={isBandit}
            ssrPolyfills={ssrPolyfills}
            disableTimeSeriesButton={disableTimeSeriesButton}
            isHoldout={experimentType === "holdout"}
          />
        </div>
      ) : null}

      {!mainTableOnly && expandedGuardrails.length ? (
        <div className="mt-4">
          <ResultsTable
            experimentId={experimentId}
            dateCreated={reportDate}
            isLatestPhase={isLatestPhase}
            phase={phase}
            startDate={startDate}
            endDate={endDate}
            status={status}
            queryStatusData={queryStatusData}
            variations={variations}
            variationFilter={variationFilter}
            baselineRow={baselineRow}
            rows={rows.filter((r) => r.resultGroup === "guardrail")}
            id={id}
            resultGroup="guardrail"
            tableRowAxis="metric"
            labelHeader="Guardrail Metrics"
            editMetrics={editMetrics}
            statsEngine={statsEngine}
            sequentialTestingEnabled={sequentialTestingEnabled}
            pValueCorrection={pValueCorrection}
            differenceType={differenceType}
            renderLabelColumn={getRenderLabelColumn({
              regressionAdjustmentEnabled,
              statsEngine,
              hideDetails,
              experimentType: undefined,
              pinnedMetricDimensionLevels,
              togglePinnedMetricDimensionLevel,
              expandedMetrics,
              toggleExpandedMetric,
              getFactMetricDimensions,
              ssrPolyfills,
              shouldShowMetricDimensions,
            })}
            metricFilter={metricFilter}
            setMetricFilter={setMetricFilter}
            metricTags={allMetricTags}
            isTabActive={isTabActive}
            noStickyHeader={noStickyHeader}
            noTooltip={noTooltip}
            isBandit={isBandit}
            ssrPolyfills={ssrPolyfills}
            disableTimeSeriesButton={disableTimeSeriesButton}
            isHoldout={experimentType === "holdout"}
          />
        </div>
      ) : (
        <></>
      )}
    </>
  );
};
export default CompactResults;

export function getRenderLabelColumn({
  regressionAdjustmentEnabled,
  statsEngine,
  hideDetails,
  experimentType: _experimentType,
  pinnedMetricDimensionLevels,
  togglePinnedMetricDimensionLevel,
  expandedMetrics,
  toggleExpandedMetric,
  getFactMetricDimensions,
  ssrPolyfills,
  shouldShowMetricDimensions,
  className = "pl-3",
}: {
  regressionAdjustmentEnabled?: boolean;
  statsEngine?: StatsEngine;
  hideDetails?: boolean;
  experimentType?: ExperimentType;
  pinnedMetricDimensionLevels?: string[];
  togglePinnedMetricDimensionLevel?: (
    metricId: string,
    dimensionLevels: Array<{ column: string; levels: string[] }>,
    resultGroup: "goal" | "secondary" | "guardrail",
  ) => void;
  expandedMetrics?: Record<string, boolean>;
  toggleExpandedMetric?: (
    metricId: string,
    resultGroup: "goal" | "secondary" | "guardrail",
  ) => void;
  getFactMetricDimensions?: (metricId: string) => unknown[];
  ssrPolyfills?: SSRPolyfills;
  shouldShowMetricDimensions?: boolean;
  className?: string;
}) {
  return function renderLabelColumn({
    label,
    metric,
    row,
    maxRows,
    location,
  }: {
    label: string;
    metric: ExperimentMetricInterface;
    row?: ExperimentTableRow;
    maxRows?: number;
    location?: "goal" | "secondary" | "guardrail";
  }) {
    const expandedKey = `${metric.id}:${location}`;
    const isExpanded = !!expandedMetrics?.[expandedKey];

    const isDimensionRow = !!row?.isDimensionRow;

    // Dimension row
    if (isDimensionRow) {
      // Generate pinned key from all dimension levels
      const pinnedKey = row?.dimensionLevels
        ? generatePinnedDimensionKey(
            metric.id,
            row.dimensionLevels.map((dl) => ({
              column: dl.column,
              levels: dl.level ? [dl.level] : [],
            })),
            location || "goal",
          )
        : "";
      const isPinned =
        pinnedMetricDimensionLevels?.includes(pinnedKey) || false;

      return (
        <div className={className} style={{ position: "relative" }}>
          {isExpanded && togglePinnedMetricDimensionLevel ? (
            <Tooltip
              body={
                isPinned
                  ? "Pinned: will be visible when the metric is collapsed"
                  : "Not pinned: will be hidden when the metric is collapsed"
              }
              tipPosition="top"
              tipMinWidth="50px"
            >
              <PiPushPinFill
                style={{
                  position: "absolute",
                  left: 4,
                  top: 3,
                  cursor: "pointer",
                }}
                size={14}
                className={isPinned ? "link-purple" : "text-muted opacity50"}
                onClick={() => {
                  if (
                    togglePinnedMetricDimensionLevel &&
                    row?.dimensionLevels
                  ) {
                    togglePinnedMetricDimensionLevel(
                      metric.id,
                      row.dimensionLevels.map((dl) => ({
                        column: dl.column,
                        levels: dl.level ? [dl.level] : [],
                      })),
                      location || "goal",
                    );
                  }
                }}
              />
            </Tooltip>
          ) : null}
          <div
            className="ml-2 font-weight-bold"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 1,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              color: "var(--color-text-mid)",
            }}
          >
            {label}
          </div>
          <div className="ml-2 text-muted small">
            {row?.dimensionLevels?.map((dl) => dl.columnName).join(" + ")}
          </div>
        </div>
      );
    }

    const hasDimensions =
      shouldShowMetricDimensions &&
      !!(
        ssrPolyfills?.getFactMetricDimensions?.(metric.id)?.length ||
        getFactMetricDimensions?.(metric.id)?.length
      );

    // Render non-dimension metric
    return (
      <div className={className} style={{ position: "relative" }}>
        <span
          className="ml-2"
          style={
            maxRows
              ? {
                  display: "-webkit-box",
                  WebkitLineClamp: maxRows,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }
              : undefined
          }
        >
          {hasDimensions ? (
            <a
              className="link-purple"
              role="button"
              onClick={() => {
                if (toggleExpandedMetric) {
                  toggleExpandedMetric(metric.id, location || "goal");
                }
              }}
              style={{
                textDecoration: "none",
              }}
            >
              <div style={{ position: "absolute", left: 4, marginTop: -1 }}>
                <Tooltip
                  body={
                    isExpanded
                      ? "Collapse metric dimensions"
                      : "Explore metric dimensions"
                  }
                  tipPosition="top"
                >
                  {isExpanded ? (
                    <PiCaretCircleDown size={16} />
                  ) : (
                    <PiCaretCircleRight size={16} />
                  )}
                </Tooltip>
              </div>
              <span
                style={{
                  lineHeight: "1.2em",
                  wordBreak: "break-word",
                  overflowWrap: "anywhere",
                  color: "var(--color-text-high)",
                }}
              >
                <Tooltip
                  body={
                    <MetricTooltipBody
                      metric={metric}
                      row={row}
                      statsEngine={statsEngine}
                      reportRegressionAdjustmentEnabled={
                        regressionAdjustmentEnabled
                      }
                      hideDetails={hideDetails}
                    />
                  }
                  tipPosition="right"
                  className="d-inline-block font-weight-bold metric-label"
                  flipTheme={false}
                  usePortal={true}
                >
                  {label}
                  {metric.managedBy ? (
                    <HiBadgeCheck
                      style={{
                        marginTop: "-2px",
                        marginLeft: "2px",
                        color: "var(--blue-11)",
                      }}
                    />
                  ) : null}
                </Tooltip>
              </span>
            </a>
          ) : (
            <Tooltip
              body={
                <MetricTooltipBody
                  metric={metric}
                  row={row}
                  statsEngine={statsEngine}
                  reportRegressionAdjustmentEnabled={
                    regressionAdjustmentEnabled
                  }
                  hideDetails={hideDetails}
                />
              }
              tipPosition="right"
              className="d-inline-block font-weight-bold metric-label"
              flipTheme={false}
              usePortal={true}
            >
              <span
                style={{
                  lineHeight: "1.2em",
                  wordBreak: "break-word",
                  overflowWrap: "anywhere",
                  color: "var(--color-text-high)",
                }}
              >
                {label}
              </span>
            </Tooltip>
          )}
        </span>
      </div>
    );
  };
}
