import { FC, ReactElement, useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
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
import { FactTableInterface } from "back-end/types/fact-table";
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
  generatePinnedSliceKey,
  SliceLevelsData,
} from "shared/experiments";
import { HiBadgeCheck } from "react-icons/hi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { ExperimentTableRow } from "@/services/experiments";
import { QueryStatusData } from "@/components/Queries/RunQueriesButton";
import { ResultsMetricFilters } from "@/components/Experiment/Results";
import Tooltip from "@/components/Tooltip/Tooltip";
import MetricTooltipBody from "@/components/Metrics/MetricTooltipBody";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useExperimentTableRows } from "@/hooks/useExperimentTableRows";
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
  pinnedMetricSlices?: string[];
  togglePinnedMetricSlice?: (
    metricId: string,
    sliceLevels: SliceLevelsData[],
    location?: "goal" | "secondary" | "guardrail",
  ) => void;
  customMetricSlices?: Array<{
    slices: Array<{
      column: string;
      levels: string[];
    }>;
  }>;
  sortBy?: "metric-tags" | "significance" | "change" | null;
  setSortBy?: (s: "metric-tags" | "significance" | "change" | null) => void;
  sortDirection?: "asc" | "desc" | null;
  setSortDirection?: (d: "asc" | "desc" | null) => void;
  analysisBarSettings?: {
    variationFilter: number[];
  };
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
  pinnedMetricSlices,
  togglePinnedMetricSlice,
  customMetricSlices,
  sortBy,
  setSortBy,
  sortDirection,
  setSortDirection,
  analysisBarSettings,
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

  const { rows, allMetricTags, getChildRowCounts } = useExperimentTableRows({
    results,
    goalMetrics,
    secondaryMetrics,
    guardrailMetrics,
    metricOverrides,
    ssrPolyfills,
    customMetricSlices,
    pinnedMetricSlices,
    metricFilter,
    sortBy,
    sortDirection,
    analysisBarSettings,
    statsEngine,
    pValueCorrection,
    settingsForSnapshotMetrics,
    shouldShowMetricSlices: true,
    enableExpansion: true,
    enablePinning: true,
    expandedMetrics,
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
            statsEngine,
            hideDetails,
            experimentType,
            pinnedMetricSlices,
            togglePinnedMetricSlice,
            expandedMetrics,
            toggleExpandedMetric,
            getExperimentMetricById,
            getFactTableById,
            shouldShowMetricSlices: true,
            getChildRowCounts,
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
          sortBy={sortBy}
          setSortBy={setSortBy}
          sortDirection={sortDirection}
          setSortDirection={setSortDirection}
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
              statsEngine,
              hideDetails,
              experimentType: undefined,
              pinnedMetricSlices,
              togglePinnedMetricSlice,
              expandedMetrics,
              toggleExpandedMetric,
              getExperimentMetricById,
              getFactTableById,
              shouldShowMetricSlices: true,
              getChildRowCounts,
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
            sortBy={sortBy}
            setSortBy={setSortBy}
            sortDirection={sortDirection}
            setSortDirection={setSortDirection}
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
              statsEngine,
              hideDetails,
              experimentType: undefined,
              pinnedMetricSlices,
              togglePinnedMetricSlice,
              expandedMetrics,
              toggleExpandedMetric,
              getExperimentMetricById,
              getFactTableById,
              shouldShowMetricSlices: true,
              getChildRowCounts,
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
            sortBy={sortBy}
            setSortBy={setSortBy}
            sortDirection={sortDirection}
            setSortDirection={setSortDirection}
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
  statsEngine,
  hideDetails,
  experimentType: _experimentType,
  pinnedMetricSlices,
  togglePinnedMetricSlice,
  expandedMetrics,
  toggleExpandedMetric,
  shouldShowMetricSlices,
  getChildRowCounts,
  pinSource,
  className = "pl-3",
}: {
  statsEngine?: StatsEngine;
  hideDetails?: boolean;
  experimentType?: ExperimentType;
  pinnedMetricSlices?: string[];
  togglePinnedMetricSlice?: (
    metricId: string,
    sliceLevels: SliceLevelsData[],
    resultGroup: "goal" | "secondary" | "guardrail",
  ) => void;
  expandedMetrics?: Record<string, boolean>;
  toggleExpandedMetric?: (
    metricId: string,
    resultGroup: "goal" | "secondary" | "guardrail",
  ) => void;
  getExperimentMetricById?: (id: string) => null | ExperimentMetricInterface;
  getFactTableById?: (id: string) => null | FactTableInterface;
  shouldShowMetricSlices?: boolean;
  getChildRowCounts?: (metricId: string) => { total: number; pinned: number };
  pinSource?: "experiment" | "custom" | "none";
  className?: string;
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
      // Generate pinned key from all slice levels
      const pinnedKey = row?.sliceLevels
        ? generatePinnedSliceKey(
            metric.id,
            row.sliceLevels.map((dl) => ({
              column: dl.column,
              datatype: dl.datatype,
              levels: dl.levels,
            })),
            location || "goal",
          )
        : "";
      const isPinned = pinnedMetricSlices?.includes(pinnedKey) || false;

      return (
        <div className={className} style={{ position: "relative" }}>
          {isExpanded && pinSource === "experiment" && isPinned && (
            <Tooltip
              body="Pinned: will be visible when the metric is collapsed"
              tipPosition="top"
              tipMinWidth="50px"
            >
              <PiPushPinFill
                style={{
                  position: "absolute",
                  left: 4,
                  top: 3,
                }}
                size={14}
                className="link-purple"
              />
            </Tooltip>
          )}
          {isExpanded &&
            (pinSource === "custom" || !pinSource) &&
            togglePinnedMetricSlice && (
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
                    if (togglePinnedMetricSlice && row?.sliceLevels) {
                      togglePinnedMetricSlice(
                        metric.id,
                        row.sliceLevels,
                        location || "goal",
                      );
                    }
                  }}
                />
              </Tooltip>
            )}
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
                      return (
                        <>
                          {dl.column}:{" "}
                          <span
                            style={{
                              fontVariant: "small-caps",
                              fontWeight: 600,
                            }}
                          >
                            null
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

    // Get child row counts for pinned indicator
    const childRowCounts =
      shouldShowMetricSlices && getChildRowCounts
        ? getChildRowCounts(metric.id)
        : { total: 0, pinned: 0 };

    const hasSlices = childRowCounts.total > 0;

    // Render non-slice metric
    return (
      <>
        <div
          className={className}
          style={{
            position: "relative",
            top:
              childRowCounts.total > 0 && toggleExpandedMetric ? -6 : undefined,
          }}
        >
          <span
            className={hasSlices && toggleExpandedMetric ? "ml-2" : undefined}
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
            {hasSlices && toggleExpandedMetric ? (
              <a
                className="link-purple"
                role="button"
                onClick={() =>
                  toggleExpandedMetric(metric.id, location || "goal")
                }
                style={{
                  textDecoration: "none",
                }}
              >
                <div style={{ position: "absolute", left: 4, marginTop: -1 }}>
                  <Tooltip
                    body={
                      isExpanded
                        ? "Collapse metric slices"
                        : "Expand metric slices"
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
                    lineHeight: "1.1em",
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
                    hideDetails={hideDetails}
                  />
                }
                tipPosition="right"
                className="d-inline-block font-weight-bold metric-label pl-2"
                flipTheme={false}
                usePortal={true}
              >
                <span
                  style={{
                    lineHeight: "1.1em",
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

        {childRowCounts.total > 0 && toggleExpandedMetric && (
          <div
            className="text-muted small"
            style={{
              position: "absolute",
              bottom: "8%",
              left: 28,
              width: "100%",
              fontStyle: "italic",
            }}
          >
            {childRowCounts.pinned} of {childRowCounts.total} pinned
          </div>
        )}
      </>
    );
  };
}
