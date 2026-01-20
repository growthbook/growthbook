import { FC, ReactElement, useMemo, useState, useEffect, useRef } from "react";
import { Flex, IconButton, Text } from "@radix-ui/themes";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
  MetricSnapshotSettings,
} from "shared/types/report";
import {
  ExperimentStatus,
  ExperimentType,
  MetricOverride,
} from "shared/types/experiment";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "shared/types/stats";
import { FactTableInterface } from "shared/types/fact-table";
import {
  PiArrowSquareOut,
  PiCaretCircleRight,
  PiCaretCircleDown,
  PiPushPinFill,
} from "react-icons/pi";
import { PiCaretCircleRight, PiCaretCircleDown } from "react-icons/pi";
import {
  expandMetricGroups,
  ExperimentMetricInterface,
  generatePinnedSliceKey,
  getMetricLink,
  SliceLevelsData,
  ExperimentSortBy,
  SetExperimentSortBy,
} from "shared/experiments";
import { HiBadgeCheck } from "react-icons/hi";
import { useExperimentTableRows } from "@/hooks/useExperimentTableRows";
import { useDefinitions } from "@/services/DefinitionsContext";
import { ExperimentTableRow } from "@/services/experiments";
import { QueryStatusData } from "@/components/Queries/RunQueriesButton";
import Tooltip from "@/components/Tooltip/Tooltip";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import MetricDrilldownModal, {
  MetricDrilldownTab,
} from "@/components/MetricDrilldown/MetricDrilldownModal";
import ResultsTable from "@/components/Experiment/ResultsTable";
import DataQualityWarning from "./DataQualityWarning";
import MultipleExposureWarning from "./MultipleExposureWarning";
import { ExperimentTab } from "./TabbedPage";
import styles from "./CompactResults.module.scss";

const CompactResults: FC<{
  experimentId: string;
  editMetrics?: () => void;
  variations: ExperimentReportVariation[];
  variationFilter?: number[];
  setVariationFilter?: (variationFilter: number[]) => void;
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
  settingsForSnapshotMetrics?: MetricSnapshotSettings[];
  sequentialTestingEnabled?: boolean;
  differenceType: DifferenceType;
  metricTagFilter?: string[];
  metricsFilter?: string[];
  sliceTagsFilter?: string[];
  isTabActive: boolean;
  setTab?: (tab: ExperimentTab) => void;
  mainTableOnly?: boolean;
  noStickyHeader?: boolean;
  noTooltip?: boolean;
  experimentType?: ExperimentType;
  ssrPolyfills?: SSRPolyfills;
  pinnedMetricSlices?: string[];
  togglePinnedMetricSlice?: (
    metricId: string,
    sliceLevels: SliceLevelsData[],
    location?: "goal" | "secondary" | "guardrail",
  ) => void;
  hideDetails?: boolean;
  disableTimeSeriesButton?: boolean;
  customMetricSlices?: Array<{
    slices: Array<{
      column: string;
      levels: string[];
    }>;
  }>;
  sortBy?: ExperimentSortBy;
  setSortBy?: SetExperimentSortBy;
  sortDirection?: "asc" | "desc" | null;
  setSortDirection?: (d: "asc" | "desc" | null) => void;
  analysisBarSettings?: {
    variationFilter: number[];
  };
  setBaselineRow?: (baselineRow: number) => void;
  snapshot?: ExperimentSnapshotInterface;
  analysis?: ExperimentSnapshotAnalysis;
  setAnalysisSettings?: (
    settings: ExperimentSnapshotAnalysisSettings | null,
  ) => void;
  mutate?: () => void;
  setDifferenceType?: (differenceType: DifferenceType) => void;
}> = ({
  experimentId,
  editMetrics,
  variations,
  variationFilter,
  setVariationFilter,
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
  settingsForSnapshotMetrics,
  sequentialTestingEnabled,
  differenceType,
  metricTagFilter,
  metricsFilter,
  sliceTagsFilter,
  isTabActive,
  setTab,
  mainTableOnly,
  noStickyHeader,
  noTooltip,
  experimentType,
  ssrPolyfills,
  pinnedMetricSlices,
  togglePinnedMetricSlice,
  hideDetails,
  disableTimeSeriesButton,
  customMetricSlices,
  sortBy,
  setSortBy,
  sortDirection,
  setSortDirection,
  analysisBarSettings,
  setBaselineRow,
  snapshot,
  analysis,
  setAnalysisSettings,
  mutate,
  setDifferenceType,
}) => {
  const {
    getExperimentMetricById: _getExperimentMetricById,
    getFactTableById: _getFactTableById,
    metricGroups: _metricGroups,
  } = useDefinitions();

  const getExperimentMetricById =
    ssrPolyfills?.getExperimentMetricById || _getExperimentMetricById;
  const getFactTableById = ssrPolyfills?.getFactTableById || _getFactTableById;
  const metricGroups = ssrPolyfills?.metricGroups || _metricGroups;

  const [totalUsers] = useMemo(() => {
    let totalUsers = 0;
    results?.variations?.forEach((v) => {
      totalUsers += v.users;
    });
    return [totalUsers];
  }, [results]);

  const [expandedMetrics, setExpandedMetrics] = useState<
    Record<string, boolean>
  >({});
  // Stable empty object for modal rows (all metrics expanded)
  const emptyExpandedMetrics = useMemo(() => ({}), []);
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

  const [openMetricDrilldownModalInfo, setOpenMetricDrilldownModalInfo] =
    useState<{
      metricRow: ExperimentTableRow;
      initialTab?: MetricDrilldownTab;
      initialSliceSearchTerm?: string;
    } | null>(null);

  const { rows, getChildRowCounts } = useExperimentTableRows({
    results,
    goalMetrics,
    secondaryMetrics,
    guardrailMetrics,
    metricOverrides,
    ssrPolyfills,
    customMetricSlices,
    metricTagFilter,
    metricsFilter,
    sliceTagsFilter,
    sortBy,
    sortDirection,
    analysisBarSettings,
    statsEngine,
    pValueCorrection,
    settingsForSnapshotMetrics,
    shouldShowMetricSlices: true,
    enableExpansion: true,
    expandedMetrics,
  });

  // Get unfiltered rows for the modal (without sliceTagsFilter)
  // This ensures all slices are available in the drilldown modal
  const { rows: unfilteredRows } = useExperimentTableRows({
    results,
    goalMetrics,
    secondaryMetrics,
    guardrailMetrics,
    metricOverrides,
    ssrPolyfills,
    customMetricSlices,
    pinnedMetricSlices,
    metricTagFilter,
    metricsFilter,
    sliceTagsFilter: undefined, // No slice filter for modal
    sortBy,
    sortDirection,
    analysisBarSettings,
    statsEngine,
    pValueCorrection,
    settingsForSnapshotMetrics,
    shouldShowMetricSlices: true,
    enableExpansion: true,
    enablePinning: true,
    expandedMetrics: emptyExpandedMetrics, // All metrics expanded for modal
  });

  const expandedGoals = useMemo(
    () =>
      expandMetricGroups(
        goalMetrics,
        ssrPolyfills?.metricGroups || metricGroups,
      ),
    [goalMetrics, metricGroups, ssrPolyfills?.metricGroups],
  );
  const expandedSecondaries = useMemo(
    () =>
      expandMetricGroups(
        secondaryMetrics,
        ssrPolyfills?.metricGroups || metricGroups,
      ),
    [secondaryMetrics, metricGroups, ssrPolyfills?.metricGroups],
  );
  const expandedGuardrails = useMemo(
    () =>
      expandMetricGroups(
        guardrailMetrics,
        ssrPolyfills?.metricGroups || metricGroups,
      ),
    [guardrailMetrics, metricGroups, ssrPolyfills?.metricGroups],
  );

  // Calculate pre-filtered metric count (allMetrics) for "No metrics" message
  const totalMetricsCount = useMemo(() => {
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
    return allMetricsMap.size;
  }, [
    expandedGoals,
    expandedSecondaries,
    expandedGuardrails,
    getExperimentMetricById,
  ]);

  // Track previous sliceTagsFilter to detect when it goes from non-empty to empty
  const prevSliceTagsFilterRef = useRef<string[] | undefined>(sliceTagsFilter);

  // Auto-expand all metrics when slice tags are selected, collapse when slice filters are cleared
  useEffect(() => {
    const allMetricIds = [
      ...expandedGoals,
      ...expandedSecondaries,
      ...expandedGuardrails,
    ];

    const prevHadSliceFilters =
      prevSliceTagsFilterRef.current &&
      prevSliceTagsFilterRef.current.length > 0;
    const currentHasSliceFilters =
      sliceTagsFilter && sliceTagsFilter.length > 0;

    if (currentHasSliceFilters) {
      // Expand all metrics for all result groups when slice filter is active
      const newExpandedMetrics: Record<string, boolean> = {};
      allMetricIds.forEach((metricId) => {
        ["goal", "secondary", "guardrail"].forEach((resultGroup) => {
          const key = `${metricId}:${resultGroup}`;
          newExpandedMetrics[key] = true;
        });
      });

      setExpandedMetrics((prev) => ({
        ...prev,
        ...newExpandedMetrics,
      }));
    } else if (prevHadSliceFilters && !currentHasSliceFilters) {
      // Collapse all metrics when slice filters go from non-empty to empty
      const collapsedMetrics: Record<string, boolean> = {};
      allMetricIds.forEach((metricId) => {
        ["goal", "secondary", "guardrail"].forEach((resultGroup) => {
          const key = `${metricId}:${resultGroup}`;
          collapsedMetrics[key] = false;
        });
      });

      setExpandedMetrics((prev) => ({
        ...prev,
        ...collapsedMetrics,
      }));
    }

    // Update ref for next render
    prevSliceTagsFilterRef.current = sliceTagsFilter;
  }, [sliceTagsFilter, expandedGoals, expandedSecondaries, expandedGuardrails]);

  const isBandit = experimentType === "multi-armed-bandit";

  // Filter rows based on expansion state when there's no slice filter
  const hasSliceFilter = sliceTagsFilter && sliceTagsFilter.length > 0;
  const filteredRows = useMemo(() => {
    if (hasSliceFilter) {
      // When filter is active, use isHiddenByFilter from the hook
      return rows;
    }
    // When no filter, filter out slice rows that aren't expanded
    return rows.filter((row) => {
      if (!row.isSliceRow) return true; // Always include parent rows
      // For slice rows, check if parent metric is expanded
      if (row.parentRowId) {
        const expandedKey = `${row.parentRowId}:${row.resultGroup}`;
        return !!expandedMetrics?.[expandedKey];
      }
      return true;
    });
  }, [rows, hasSliceFilter, expandedMetrics]);

  const handleRowClick = (row: ExperimentTableRow) => {
    // Always get the main (non-slice) metric row from unfilteredRows for proper data
    const metricId = row.isSliceRow ? row.parentRowId : row.metric.id;
    const mainMetricRow = unfilteredRows.find(
      (r) => !r.isSliceRow && r.metric.id === metricId,
    );

    if (row.isSliceRow) {
      setOpenMetricDrilldownModalInfo({
        metricRow: mainMetricRow ?? row,
        initialTab: "slices",
        // FIXME: What happens if it is not a string and a React element?
        initialSliceSearchTerm: row.label.toString() ?? "",
      });
    } else {
      setOpenMetricDrilldownModalInfo({
        metricRow: mainMetricRow ?? row,
        initialTab: "overview",
      });
    }
  };

  return (
    <>
      {!mainTableOnly && (
        <>
          <Flex direction="column" gap="2" mx="3">
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
          </Flex>
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
          setVariationFilter={setVariationFilter}
          baselineRow={baselineRow}
          rows={filteredRows.filter((r) => r.resultGroup === "goal")}
          onRowClick={handleRowClick}
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
          setDifferenceType={setDifferenceType}
          totalMetricsCount={totalMetricsCount}
          renderLabelColumn={getRenderLabelColumn({
            pinnedMetricSlices,
            togglePinnedMetricSlice,
            statsEngine,
            hideDetails,
            expandedMetrics,
            toggleExpandedMetric,
            getExperimentMetricById,
            getFactTableById,
            shouldShowMetricSlices: true,
            getChildRowCounts,
            sliceTagsFilter,
          })}
          isTabActive={isTabActive}
          noStickyHeader={noStickyHeader}
          noTooltip={noTooltip}
          isBandit={isBandit}
          isGoalMetrics={true}
          ssrPolyfills={ssrPolyfills}
          isHoldout={experimentType === "holdout"}
          sortBy={sortBy}
          setSortBy={setSortBy}
          sortDirection={sortDirection}
          setSortDirection={setSortDirection}
          setBaselineRow={setBaselineRow}
          snapshot={snapshot}
          analysis={analysis}
          setAnalysisSettings={setAnalysisSettings}
          mutate={mutate}
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
            setVariationFilter={setVariationFilter}
            baselineRow={baselineRow}
            rows={filteredRows.filter((r) => r.resultGroup === "secondary")}
            onRowClick={handleRowClick}
            id={id}
            resultGroup="secondary"
            tableRowAxis="metric"
            labelHeader="Secondary Metrics"
            editMetrics={editMetrics}
            statsEngine={statsEngine}
            sequentialTestingEnabled={sequentialTestingEnabled}
            pValueCorrection={pValueCorrection}
            differenceType={differenceType}
            setDifferenceType={setDifferenceType}
            totalMetricsCount={totalMetricsCount}
            renderLabelColumn={getRenderLabelColumn({
              pinnedMetricSlices,
              togglePinnedMetricSlice,
              statsEngine,
              hideDetails,
              expandedMetrics,
              toggleExpandedMetric,
              getExperimentMetricById,
              getFactTableById,
              shouldShowMetricSlices: true,
              getChildRowCounts,
              sliceTagsFilter,
            })}
            isTabActive={isTabActive}
            noStickyHeader={noStickyHeader}
            noTooltip={noTooltip}
            isBandit={isBandit}
            ssrPolyfills={ssrPolyfills}
            isHoldout={experimentType === "holdout"}
            sortBy={sortBy}
            setSortBy={setSortBy}
            sortDirection={sortDirection}
            setSortDirection={setSortDirection}
            setBaselineRow={setBaselineRow}
            snapshot={snapshot}
            analysis={analysis}
            setAnalysisSettings={setAnalysisSettings}
            mutate={mutate}
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
            setVariationFilter={setVariationFilter}
            baselineRow={baselineRow}
            rows={filteredRows.filter((r) => r.resultGroup === "guardrail")}
            onRowClick={handleRowClick}
            id={id}
            resultGroup="guardrail"
            tableRowAxis="metric"
            labelHeader="Guardrail Metrics"
            editMetrics={editMetrics}
            statsEngine={statsEngine}
            sequentialTestingEnabled={sequentialTestingEnabled}
            pValueCorrection={pValueCorrection}
            differenceType={differenceType}
            setDifferenceType={setDifferenceType}
            totalMetricsCount={totalMetricsCount}
            renderLabelColumn={getRenderLabelColumn({
              pinnedMetricSlices,
              togglePinnedMetricSlice,
              statsEngine,
              hideDetails,
              expandedMetrics,
              toggleExpandedMetric,
              getExperimentMetricById,
              getFactTableById,
              shouldShowMetricSlices: true,
              getChildRowCounts,
              sliceTagsFilter,
            })}
            isTabActive={isTabActive}
            noStickyHeader={noStickyHeader}
            noTooltip={noTooltip}
            isBandit={isBandit}
            ssrPolyfills={ssrPolyfills}
            isHoldout={experimentType === "holdout"}
            sortBy={sortBy}
            setSortBy={setSortBy}
            sortDirection={sortDirection}
            setSortDirection={setSortDirection}
            setBaselineRow={setBaselineRow}
            snapshot={snapshot}
            analysis={analysis}
            setAnalysisSettings={setAnalysisSettings}
            mutate={mutate}
          />
        </div>
      ) : (
        <></>
      )}

      {openMetricDrilldownModalInfo !== null && (
        <MetricDrilldownModal
          statsEngine={statsEngine}
          row={openMetricDrilldownModalInfo.metricRow}
          close={() => setOpenMetricDrilldownModalInfo(null)}
          initialTab={openMetricDrilldownModalInfo.initialTab}
          experimentId={experimentId}
          phase={phase}
          experimentStatus={status}
          differenceType={differenceType}
          goalMetrics={goalMetrics}
          secondaryMetrics={secondaryMetrics}
          guardrailMetrics={guardrailMetrics}
          baselineRow={baselineRow}
          variations={variations}
          variationFilter={variationFilter}
          startDate={startDate}
          endDate={endDate}
          reportDate={reportDate}
          isLatestPhase={isLatestPhase}
          pValueCorrection={pValueCorrection}
          sequentialTestingEnabled={sequentialTestingEnabled}
          allRows={unfilteredRows}
          initialSliceSearchTerm={
            openMetricDrilldownModalInfo.initialSliceSearchTerm
          }
        />
      )}
    </>
  );
};
export default CompactResults;

export function getRenderLabelColumn({
  pinnedMetricSlices,
  togglePinnedMetricSlice,
  statsEngine,
  hideDetails,
  expandedMetrics,
  toggleExpandedMetric,
  shouldShowMetricSlices,
  getChildRowCounts,
  sliceTagsFilter,
}: {
  pinnedMetricSlices?: string[];
  togglePinnedMetricSlice?: (
    metricId: string,
    sliceLevels: SliceLevelsData[],
    resultGroup: "goal" | "secondary" | "guardrail",
  ) => void;
  statsEngine?: StatsEngine;
  hideDetails?: boolean;
  expandedMetrics?: Record<string, boolean>;
  toggleExpandedMetric?: (
    metricId: string,
    resultGroup: "goal" | "secondary" | "guardrail",
  ) => void;
  getExperimentMetricById?: (id: string) => null | ExperimentMetricInterface;
  getFactTableById?: (id: string) => null | FactTableInterface;
  shouldShowMetricSlices?: boolean;
  getChildRowCounts?: (metricId: string) => number;
  sliceTagsFilter?: string[];
}) {
  return function renderLabelColumn({
    label,
    metric,
    row,
    maxRows,
    location,
  }: {
    label: string | ReactElement;
    metric: ExperimentMetricInterface;
    row?: ExperimentTableRow;
    maxRows?: number;
    location?: "goal" | "secondary" | "guardrail";
  }) {
    const expandedKey = `${metric.id}:${location}`;
    const isExpanded = !!expandedMetrics?.[expandedKey];

    const isSliceRow = !!row?.isSliceRow;

    // Slice row
    if (isSliceRow) {
      return (
        <div className="pl-4" style={{ position: "relative" }}>
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
            {row?.isSliceRow && row.sliceLevels ? (
              <>
                {row.sliceLevels.map((dl, index) => {
                  const content = (() => {
                    if (dl.levels.length === 0) {
                      const emptyValue =
                        dl.datatype === "string" ? "other" : "null";
                      return (
                        <>
                          {dl.column}:{" "}
                          <span
                            style={{
                              fontVariant: "small-caps",
                              fontWeight: 600,
                            }}
                          >
                            {emptyValue}
                          </span>
                        </>
                      );
                    }
                    const value = dl.levels[0];
                    if (dl.datatype === "boolean") {
                      return (
                        <>
                          {dl.column}:{" "}
                          <span
                            style={{
                              fontVariant: "small-caps",
                              fontWeight: 600,
                            }}
                          >
                            {value}
                          </span>
                        </>
                      );
                    }
                    return value;
                  })();

                  return (
                    <span key={`${dl.column}-${index}`}>
                      {content}
                      {index < (row.sliceLevels?.length || 0) - 1 && (
                        <span> + </span>
                      )}
                    </span>
                  );
                })}
              </>
            ) : (
              label
            )}
          </div>
          <div className="ml-2 text-muted small">
            {row?.sliceLevels?.map((dl) => dl.column).join(" + ")}
          </div>
        </div>
      );
    }

    const childRowCount =
      shouldShowMetricSlices && getChildRowCounts
        ? getChildRowCounts(metric.id)
        : 0;
    const hasSlices = childRowCount > 0;
    const shouldShowExpandButton =
      toggleExpandedMetric &&
      hasSlices &&
      !row?.labelOnly &&
      !sliceTagsFilter?.length;

    // Render non-slice metric
    return (
      <>
        <div className="pl-3">
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
            {shouldShowExpandButton ? (
              <div style={{ position: "absolute", left: 7, marginTop: 3 }}>
                <Tooltip
                  body={
                    isExpanded
                      ? "Collapse metric slices"
                      : "Expand metric slices"
                  }
                  tipPosition="top"
                >
                  <IconButton
                    size="1"
                    variant="ghost"
                    radius="full"
                    onClick={
                      row?.labelOnly || sliceTagsFilter?.includes("overall")
                        ? undefined
                        : () =>
                            toggleExpandedMetric(metric.id, location || "goal")
                    }
                    disabled={
                      row?.labelOnly || sliceTagsFilter?.includes("overall")
                    }
                  >
                    {isExpanded ? (
                      <PiCaretCircleDown size={16} />
                    ) : (
                      <PiCaretCircleRight size={16} />
                    )}
                  </IconButton>
                </Tooltip>
              </div>
            ) : null}
            <span
              className="metric-label-cell"
              style={{
                lineHeight: "1.1em",
                wordBreak: "break-word",
                overflowWrap: "anywhere",
                color: "var(--color-text-high)",
              }}
            >
              <Text weight="bold">
                {typeof label === "string" ? (
                  <>
                    {label.includes(" ")
                      ? label.slice(0, label.lastIndexOf(" ") + 1)
                      : ""}
                    <span className={styles.metricLabelLastWord}>
                      {label.includes(" ")
                        ? label.slice(label.lastIndexOf(" ") + 1)
                        : label}
                      {metric.managedBy ? (
                        <HiBadgeCheck
                          style={{
                            marginTop: "-2px",
                            marginLeft: "2px",
                            color: "var(--blue-11)",
                          }}
                        />
                      ) : null}
                      <a
                        href={getMetricLink(metric.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.metricExternalLink}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <PiArrowSquareOut size={14} />
                      </a>
                    </span>
                  </>
                ) : (
                  <>
                    {label}
                    <span className={styles.metricLabelLastWord}>
                      {metric.managedBy ? (
                        <HiBadgeCheck
                          style={{
                            marginTop: "-2px",
                            marginLeft: "2px",
                            color: "var(--blue-11)",
                          }}
                        />
                      ) : null}
                      <a
                        href={getMetricLink(metric.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.metricExternalLink}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <PiArrowSquareOut size={14} />
                      </a>
                    </span>
                  </>
                )}
              </Text>
            </span>
          </span>
        </div>
      </>
    );
  };
}
