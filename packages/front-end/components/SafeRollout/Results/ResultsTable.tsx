import clsx from "clsx";
import {
  CSSProperties,
  ReactElement,
  ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { RxInfoCircled } from "react-icons/rx";
import { FaExclamationTriangle } from "react-icons/fa";
import { Box, Flex, Popover } from "@radix-ui/themes";
import { extent } from "@visx/vendor/d3-array";
import {
  ExperimentReportVariation,
  ExperimentReportVariationWithIndex,
} from "shared/types/report";
import { ExperimentStatus } from "shared/types/experiment";
import { MetricTimeSeries } from "shared/validators";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "shared/types/stats";
import { getValidDate } from "shared/dates";
import { filterInvalidMetricTimeSeries } from "shared/util";
import { ExperimentMetricInterface, isFactMetric } from "shared/experiments";
import { PiPencilSimpleFill } from "react-icons/pi";
import AnalysisResultSummary from "@/ui/AnalysisResultSummary";
import { useAnalysisResultSummary } from "@/ui/hooks/useAnalysisResultSummary";
import {
  ExperimentTableRow,
  getEffectLabel,
  getRowResults,
  RowResults,
} from "@/services/experiments";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { useCurrency } from "@/hooks/useCurrency";
import { QueryStatusData } from "@/components/Queries/RunQueriesButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import SafeRolloutTimeSeriesGraph from "@/components/Experiment/SafeRolloutTimeSeriesGraph";
import Tooltip from "@/components/Tooltip/Tooltip";
import useApi from "@/hooks/useApi";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useSafeRolloutSnapshot } from "@/components/SafeRollout/SnapshotProvider";
import ChangeColumn from "./ChangeColumn";
import StatusColumn from "./StatusColumn";

export type ResultsTableProps = {
  id: string;
  variations: ExperimentReportVariation[];
  variationFilter?: number[];
  baselineRow?: number;
  status: ExperimentStatus;
  queryStatusData?: QueryStatusData;
  isLatestPhase: boolean;
  startDate: string;
  rows: ExperimentTableRow[];
  dimension?: string;
  editMetrics?: () => void;
  renderLabelColumn: ({
    label,
    metric,
    row,
    maxRows,
  }: {
    label: string | ReactNode;
    metric: ExperimentMetricInterface;
    row: ExperimentTableRow;
    maxRows?: number;
  }) => string | ReactElement;
  dateCreated: Date;
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  differenceType: DifferenceType;
  isTabActive: boolean;
  noStickyHeader?: boolean;
  noTooltip?: boolean;
  isBandit?: boolean;
  isGoalMetrics?: boolean;
  ssrPolyfills?: SSRPolyfills;
};

export default function ResultsTable({
  id,
  isLatestPhase,
  status,
  queryStatusData,
  rows,
  dimension,
  editMetrics,
  variations,
  variationFilter,
  baselineRow = 0,
  startDate,
  renderLabelColumn,
  dateCreated,
  statsEngine,
  pValueCorrection,
  differenceType,
  isTabActive,
  noStickyHeader,
  noTooltip,
  isBandit,
  ssrPolyfills,
}: ResultsTableProps) {
  // fix any potential filter conflicts
  if (variationFilter?.includes(baselineRow)) {
    variationFilter = variationFilter.filter((v) => v !== baselineRow);
  }

  const { getExperimentMetricById, getFactTableById } = useDefinitions();

  const _useOrganizationMetricDefaults = useOrganizationMetricDefaults();
  const { metricDefaults, getMinSampleSizeForMetric } =
    ssrPolyfills?.useOrganizationMetricDefaults?.() ||
    _useOrganizationMetricDefaults;

  const _confidenceLevels = useConfidenceLevels();
  const _pValueThreshold = usePValueThreshold();
  const _displayCurrency = useCurrency();

  const { ciUpper, ciLower } =
    ssrPolyfills?.useConfidenceLevels?.() || _confidenceLevels;
  const pValueThreshold =
    ssrPolyfills?.usePValueThreshold?.() || _pValueThreshold;
  const displayCurrency = ssrPolyfills?.useCurrency?.() || _displayCurrency;

  const showTimeSeries = useFeatureIsOn("safe-rollout-timeseries");

  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const [tableCellScale, setTableCellScale] = useState(1);

  function onResize() {
    if (!tableContainerRef?.current?.clientWidth) return;
    const tableWidth = tableContainerRef.current?.clientWidth as number;

    setTableCellScale(Math.max(Math.min(1, tableWidth / 1000), 0.85));
  }

  useEffect(() => {
    globalThis.window?.addEventListener("resize", onResize, false);
    return () =>
      globalThis.window?.removeEventListener("resize", onResize, false);
  }, []);
  useLayoutEffect(onResize, []);
  useEffect(onResize, [isTabActive]);

  const orderedVariations: ExperimentReportVariationWithIndex[] =
    useMemo(() => {
      const sorted = variations
        .map<ExperimentReportVariationWithIndex>((v, i) => ({ ...v, index: i }))
        .sort((a, b) => {
          if (a.index === baselineRow) return -1;
          return a.index - b.index;
        });
      // fix browser .sort() quirks. manually move the control row to top:
      const baselineIndex = sorted.findIndex((v) => v.index === baselineRow);
      if (baselineIndex > -1) {
        const baseline = sorted[baselineIndex];
        sorted.splice(baselineIndex, 1);
        sorted.unshift(baseline);
      }
      return sorted;
    }, [variations, baselineRow]);

  const filteredVariations = orderedVariations.filter(
    (v) => !variationFilter?.includes(v.index),
  );
  const compactResults = filteredVariations.length <= 2;

  const rowsResults: (RowResults | "query error" | null)[][] = useMemo(() => {
    const rr: (RowResults | "query error" | null)[][] = [];
    rows.map((row, i) => {
      rr.push([]);
      const baseline = row.variations[baselineRow] || {
        value: 0,
        cr: 0,
        users: 0,
      };
      orderedVariations.map((v) => {
        let skipVariation = false;
        if (variationFilter?.length && variationFilter?.includes(v.index)) {
          skipVariation = true;
        }
        if (v.index === baselineRow) {
          skipVariation = true;
        }
        if (skipVariation) {
          rr[i].push(null);
          return;
        }
        if (
          queryStatusData?.status === "partially-succeeded" &&
          queryStatusData?.failedNames?.includes(row.metric.id)
        ) {
          rr[i].push("query error");
          return;
        }
        const stats = row.variations[v.index] || {
          value: 0,
          cr: 0,
          users: 0,
        };

        const denominator =
          !isFactMetric(row.metric) && row.metric.denominator
            ? ((ssrPolyfills?.getExperimentMetricById?.(
                row.metric.denominator,
              ) ||
                getExperimentMetricById(row.metric.denominator)) ??
              undefined)
            : undefined;
        const rowResults = getRowResults({
          stats,
          baseline,
          metric: row.metric,
          denominator,
          metricDefaults,
          isGuardrail: row.resultGroup === "guardrail",
          minSampleSize: getMinSampleSizeForMetric(row.metric),
          statsEngine,
          differenceType,
          ciUpper,
          ciLower,
          pValueThreshold,
          snapshotDate: getValidDate(dateCreated),
          phaseStartDate: getValidDate(startDate),
          isLatestPhase,
          experimentStatus: status,
          displayCurrency,
          getFactTableById: ssrPolyfills?.getFactTableById || getFactTableById,
        });
        rr[i].push(rowResults);
      });
    });
    return rr;
  }, [
    rows,
    orderedVariations,
    baselineRow,
    variationFilter,
    metricDefaults,
    getMinSampleSizeForMetric,
    statsEngine,
    differenceType,
    ciUpper,
    ciLower,
    pValueThreshold,
    dateCreated,
    startDate,
    isLatestPhase,
    status,
    displayCurrency,
    queryStatusData,
    ssrPolyfills,
    getFactTableById,
    getExperimentMetricById,
  ]);

  const {
    getTooltipData,
    isRowTooltipOpen,
    setOpenTooltipRowIndex,
    handleRowTooltipMouseEnter,
    handleRowTooltipMouseLeave,
  } = useAnalysisResultSummary({
    orderedVariations,
    rows,
    rowsResults,
    dimension,
    statsEngine,
    pValueCorrection,
    differenceType,
    noTooltip,
  });

  const noMetrics = rows.length === 0;

  const changeTitle = getEffectLabel(differenceType);

  const urlFormattedMetricIds = rows
    .map((row) => encodeURIComponent(row.metric.id))
    .join("&metricIds[]=");
  const { data: metricTimeSeries, mutate: mutateMetricTimeSeries } = useApi<{
    status: number;
    timeSeries: MetricTimeSeries[];
  }>(`/safe-rollout/${id}/time-series?metricIds[]=${urlFormattedMetricIds}`, {
    shouldRun: () => showTimeSeries,
  });

  const filteredMetricTimeSeries = useMemo(() => {
    if (!metricTimeSeries) return undefined;
    return filterInvalidMetricTimeSeries(metricTimeSeries.timeSeries);
  }, [metricTimeSeries]);

  const metricTimeSeriesMap = useMemo(() => {
    return filteredMetricTimeSeries?.reduce(
      (acc, curr) => {
        acc[curr.metricId] = curr;
        return acc;
      },
      {} as Record<string, MetricTimeSeries>,
    );
  }, [filteredMetricTimeSeries]);

  const metricTimeSeriesDateExtent = useMemo(() => {
    const dataPoints = filteredMetricTimeSeries?.flatMap((t) =>
      t.dataPoints.map((d) => getValidDate(d.date)),
    );
    if (!dataPoints) return [undefined, undefined] as [undefined, undefined];
    return extent(dataPoints);
  }, [filteredMetricTimeSeries]);

  // Ensure that if we get a new snapshot, we refetch the metric time series
  const { snapshot } = useSafeRolloutSnapshot();
  useEffect(() => {
    mutateMetricTimeSeries();
  }, [snapshot?.id, mutateMetricTimeSeries]);

  return (
    <div className="position-relative">
      <div
        ref={tableContainerRef}
        className="experiment-results-wrapper px-4 pb-4"
      >
        <div className="w-100" style={{ minWidth: 700 }}>
          <table id="main-results" className="experiment-results table-sm">
            <thead>
              <tr className="results-top-row">
                <th
                  className={clsx("axis-col label", { noStickyHeader })}
                  style={{
                    width: 220 * tableCellScale,
                  }}
                >
                  <div className="row px-0">
                    <span className="pl-1" />
                    <div
                      className="col-auto px-1"
                      style={{
                        wordBreak: "break-word",
                        overflowWrap: "anywhere",
                      }}
                    >
                      Metric
                    </div>
                    {editMetrics ? (
                      <div className="col d-flex align-items-end px-0">
                        <a
                          role="button"
                          className="ml-1 cursor-pointer"
                          onClick={(e) => {
                            e.preventDefault();
                            editMetrics();
                          }}
                        >
                          <PiPencilSimpleFill />
                        </a>
                      </div>
                    ) : null}
                  </div>
                </th>
                {!noMetrics ? (
                  <>
                    {showTimeSeries ? (
                      <th
                        style={{ width: 100 * tableCellScale }}
                        className={clsx("axis-col label", { noStickyHeader })}
                      >
                        Time series
                      </th>
                    ) : null}
                    <th
                      style={{ width: 120 * tableCellScale }}
                      className={clsx("axis-col label", { noStickyHeader })}
                    >
                      <Tooltip
                        usePortal={true}
                        innerClassName={"text-left"}
                        body={
                          <div style={{ lineHeight: 1.5 }}>
                            Guardrails are either within bounds or failing. Once
                            a guardrail is statistically significant in the
                            undesirable direction, the status is changed to
                            failing. All safe rollouts use frequentist
                            sequential testing to enable reverting issues as
                            soon as they appear without increased false positive
                            rates.
                          </div>
                        }
                      >
                        Status
                        <RxInfoCircled className="ml-1" />
                      </Tooltip>
                    </th>
                    {!showTimeSeries ? (
                      <th
                        style={{ width: 150 * tableCellScale }}
                        className={clsx("axis-col label text-right", {
                          noStickyHeader,
                        })}
                      >
                        <div style={{ lineHeight: "15px", marginBottom: 2 }}>
                          <Tooltip
                            usePortal={true}
                            innerClassName={"text-left"}
                            body={
                              <div style={{ lineHeight: 1.5 }}>
                                {getChangeTooltip(changeTitle, differenceType)}
                              </div>
                            }
                          >
                            {changeTitle} <RxInfoCircled />
                          </Tooltip>
                        </div>
                      </th>
                    ) : null}
                  </>
                ) : (
                  <th
                    className={clsx("axis-col label", { noStickyHeader })}
                    colSpan={5}
                  />
                )}
              </tr>
            </thead>

            {rows.map((row, i) => {
              const baseline = row.variations[baselineRow] || {
                value: 0,
                cr: 0,
                users: 0,
              };
              let alreadyShownQueryError = false;

              return (
                <tbody className={clsx("results-group-row")} key={i}>
                  {!compactResults &&
                    drawEmptyRow({
                      className: "results-label-row",
                      label: renderLabelColumn({
                        label: row.label,
                        metric: row.metric,
                        row,
                      }),
                    })}

                  {orderedVariations.map((v, j) => {
                    const stats = row.variations[v.index] || {
                      value: 0,
                      cr: 0,
                      users: 0,
                    };
                    const rowResults = rowsResults?.[i]?.[j];
                    if (!rowResults) {
                      return null;
                    }
                    if (rowResults === "query error") {
                      if (!alreadyShownQueryError) {
                        alreadyShownQueryError = true;
                        return drawEmptyRow({
                          key: j,
                          className:
                            "results-variation-row align-items-center error-row",
                          label: (
                            <>
                              {compactResults ? (
                                <div className="mb-1">
                                  {renderLabelColumn({
                                    label: row.label,
                                    metric: row.metric,
                                    row,
                                  })}
                                </div>
                              ) : null}
                              <div className="alert alert-danger px-2 py-1 mb-1 ml-1">
                                <FaExclamationTriangle className="mr-1" />
                                Query error
                              </div>
                            </>
                          ),
                        });
                      } else {
                        return null;
                      }
                    }

                    const hideScaledImpact =
                      !rowResults.hasScaledImpact &&
                      differenceType === "scaled";

                    const resultsHighlightClassname = clsx(
                      rowResults.resultsStatus,
                      {
                        "non-significant": !rowResults.significant,
                      },
                    );

                    const tooltipData = getTooltipData(i, j);

                    const metricTimeSeries =
                      metricTimeSeriesMap?.[row.metric.id];

                    return (
                      <Popover.Root
                        key={`${i}-${j}`}
                        open={isRowTooltipOpen(i, j)}
                        onOpenChange={(open) =>
                          setOpenTooltipRowIndex(open ? i : null)
                        }
                      >
                        <Popover.Content
                          onMouseEnter={() => handleRowTooltipMouseEnter(i, j)}
                          onMouseLeave={() => handleRowTooltipMouseLeave(i, j)}
                          side="bottom"
                          sideOffset={-5}
                        >
                          <AnalysisResultSummary
                            data={
                              tooltipData
                                ? {
                                    ...tooltipData,
                                    sliceLevels: tooltipData.sliceLevels?.map(
                                      (dl) => ({
                                        dimension: dl.column,
                                        levels: dl.levels,
                                      }),
                                    ),
                                  }
                                : undefined
                            }
                            differenceType={differenceType}
                            isBandit={isBandit}
                            ssrPolyfills={ssrPolyfills}
                          />
                        </Popover.Content>

                        <tr
                          className="results-variation-row align-items-center"
                          key={j}
                        >
                          <td
                            className={`variation with-variation-label variation${v.index} py-4`}
                            style={{
                              width: 220 * tableCellScale,
                            }}
                          >
                            {!compactResults ? (
                              <div className="d-flex align-items-center">
                                <span
                                  className="label ml-1"
                                  style={{ width: 20, height: 20 }}
                                >
                                  {v.index}
                                </span>
                                <span
                                  className="d-inline-block text-ellipsis"
                                  title={v.name}
                                  style={{
                                    width: 165 * tableCellScale,
                                  }}
                                >
                                  {v.name}
                                </span>
                              </div>
                            ) : (
                              renderLabelColumn({
                                label: row.label,
                                metric: row.metric,
                                row,
                                maxRows: 3,
                              })
                            )}
                          </td>
                          {j > 0 &&
                          showTimeSeries &&
                          metricTimeSeries &&
                          metricTimeSeries.dataPoints.length > 0 ? (
                            <td style={{ padding: 0, height: 1 }}>
                              <SafeRolloutTimeSeriesGraph
                                data={metricTimeSeries}
                                xDateRange={metricTimeSeriesDateExtent}
                                ssrPolyfills={ssrPolyfills}
                              />
                            </td>
                          ) : j > 0 && showTimeSeries ? (
                            <td>
                              {!metricTimeSeries ? (
                                <Flex
                                  align="center"
                                  justify="center"
                                  position="relative"
                                  width="100%"
                                >
                                  No time series data
                                </Flex>
                              ) : null}
                            </td>
                          ) : null}
                          {j > 0 ? (
                            <td
                              className="variation chance align-middle"
                              // To allow us to have height 100% for the div inside the td
                              style={{ height: "1px" }}
                            >
                              <Popover.Trigger
                                onMouseEnter={() =>
                                  handleRowTooltipMouseEnter(i, j)
                                }
                                onMouseLeave={() =>
                                  handleRowTooltipMouseLeave(i, j)
                                }
                              >
                                <Box height="100%">
                                  <StatusColumn
                                    stats={stats}
                                    baseline={baseline}
                                    rowResults={rowResults}
                                    hideScaledImpact={hideScaledImpact}
                                    className={clsx(
                                      "results-pval",
                                      resultsHighlightClassname,
                                    )}
                                  />
                                  <Popover.Anchor />
                                </Box>
                              </Popover.Trigger>
                            </td>
                          ) : (
                            <td></td>
                          )}
                          {j > 0 && !showTimeSeries ? (
                            <td
                              className="results-change"
                              // To allow us to have height 100% for the div inside the td
                              style={{ height: "1px" }}
                            >
                              <Popover.Trigger
                                onMouseEnter={() =>
                                  handleRowTooltipMouseEnter(i, j)
                                }
                                onMouseLeave={() =>
                                  handleRowTooltipMouseLeave(i, j)
                                }
                              >
                                <Box height="100%">
                                  <ChangeColumn
                                    metric={row.metric}
                                    stats={stats}
                                    rowResults={rowResults}
                                    differenceType={differenceType}
                                    statsEngine={statsEngine}
                                    className={resultsHighlightClassname}
                                    ssrPolyfills={ssrPolyfills}
                                    showPlusMinus={false}
                                  />
                                </Box>
                              </Popover.Trigger>
                            </td>
                          ) : null}
                        </tr>
                      </Popover.Root>
                    );
                  })}
                </tbody>
              );
            })}
          </table>

          {noMetrics ? (
            <div className="metric-label py-2" style={{ marginLeft: 10 }}>
              <div className="metriclabel text-muted font-weight-bold">
                No metrics yet
              </div>
              <div className="small mt-1 mb-2">
                Add metrics to start tracking the performance of your
                experiment.
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function drawEmptyRow({
  key,
  className,
  style,
  label,
}: {
  key?: number | string;
  className?: string;
  style?: CSSProperties;
  label?: string | ReactElement;
}) {
  return (
    <tr key={key} style={style} className={className}>
      <td colSpan={3}>{label}</td>
      <td />
    </tr>
  );
}

function getChangeTooltip(changeTitle: string, differenceType: DifferenceType) {
  let changeText =
    "The uplift comparing the variation to the baseline, in percent change from the baseline value.";
  if (differenceType == "absolute") {
    changeText =
      "The absolute difference between the average values in the variation and the baseline. For non-ratio metrics, this is average difference between users in the variation and the baseline.";
  } else if (differenceType == "scaled") {
    changeText =
      "The total change in the metric per day if 100% of traffic were to have gone to the variation.";
  }

  const changeElem = (
    <>
      <p>
        <b>{changeTitle}</b> - {changeText}
      </p>
    </>
  );
  return <>{changeElem}</>;
}
