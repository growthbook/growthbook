import clsx from "clsx";
import {
  CSSProperties,
  ReactElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CSSTransition } from "react-transition-group";
import { RxInfoCircled } from "react-icons/rx";
import {
  ExperimentReportVariation,
  ExperimentReportVariationWithIndex,
} from "back-end/types/report";
import { ExperimentStatus } from "back-end/types/experiment";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "back-end/types/stats";
import { getValidDate } from "shared/dates";
import { FaExclamationTriangle } from "react-icons/fa";
import { ExperimentMetricInterface, isFactMetric } from "shared/experiments";
import {
  ExperimentTableRow,
  getEffectLabel,
  getRowResults,
  RowResults,
} from "@/services/experiments";
import { GBEdit } from "@/components/Icons";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { useCurrency } from "@/hooks/useCurrency";
import ChangeColumn from "@/components/Experiment/ChangeColumn";
import ResultsTableTooltip, {
  TooltipHoverSettings,
} from "@/components/Experiment/ResultsTableTooltip/ResultsTableTooltip";
import { QueryStatusData } from "@/components/Queries/RunQueriesButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import ResultsMetricFilter from "@/components/Experiment/ResultsMetricFilter";
import { ResultsMetricFilters } from "@/components/Experiment/Results";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useResultsTableTooltip } from "@/components/Experiment/ResultsTableTooltip/useResultsTableTooltip";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
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
  renderLabelColumn: (
    label: string,
    metric: ExperimentMetricInterface,
    row: ExperimentTableRow,
    maxRows?: number
  ) => string | ReactElement;
  dateCreated: Date;
  hasRisk: boolean;
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  differenceType: DifferenceType;
  metricFilter?: ResultsMetricFilters;
  setMetricFilter?: (filter: ResultsMetricFilters) => void;
  metricTags?: string[];
  isTabActive: boolean;
  noStickyHeader?: boolean;
  noTooltip?: boolean;
  isBandit?: boolean;
  isGoalMetrics?: boolean;
  ssrPolyfills?: SSRPolyfills;
};

export default function ResultsTable({
  id: _,
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
  metricFilter,
  setMetricFilter,
  metricTags = [],
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

  const [showMetricFilter, setShowMetricFilter] = useState<boolean>(false);

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

  const orderedVariations: ExperimentReportVariationWithIndex[] = useMemo(() => {
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
    (v) => !variationFilter?.includes(v.index)
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
            ? (ssrPolyfills?.getExperimentMetricById?.(
                row.metric.denominator
              ) ||
                getExperimentMetricById(row.metric.denominator)) ??
              undefined
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
    containerRef,
    tooltipOpen,
    tooltipData,
    hoveredX,
    hoveredY,
    hoverRow,
    leaveRow,
    closeTooltip,
    hoveredMetricRow,
    hoveredVariationRow,
    resetTimeout,
    TooltipInPortal,
  } = useResultsTableTooltip({
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

  return (
    <div className="position-relative" ref={containerRef}>
      <TooltipInPortal
        left={hoveredX ?? 0}
        top={hoveredY ?? 0}
        key={Math.random()}
        style={{
          backgroundColor: "transparent",
          boxShadow: "none",
          position: "absolute",
        }}
      >
        <CSSTransition
          key={`${hoveredMetricRow}-${hoveredVariationRow}`}
          in={
            tooltipOpen &&
            tooltipData &&
            hoveredX !== null &&
            hoveredY !== null &&
            hoveredMetricRow !== null &&
            hoveredVariationRow !== null
          }
          timeout={200}
          classNames="tooltip-animate"
          appear={true}
        >
          <ResultsTableTooltip
            left={0}
            top={0}
            data={tooltipData}
            tooltipOpen={tooltipOpen}
            close={closeTooltip}
            differenceType={differenceType}
            onPointerMove={resetTimeout}
            onClick={resetTimeout}
            onPointerLeave={leaveRow}
            isBandit={isBandit}
            ssrPolyfills={ssrPolyfills}
          />
        </CSSTransition>
      </TooltipInPortal>

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
                    {setMetricFilter ? (
                      <ResultsMetricFilter
                        metricTags={metricTags}
                        metricFilter={metricFilter}
                        setMetricFilter={setMetricFilter}
                        showMetricFilter={showMetricFilter}
                        setShowMetricFilter={setShowMetricFilter}
                      />
                    ) : (
                      <span className="pl-1" />
                    )}
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
                          <GBEdit />
                        </a>
                      </div>
                    ) : null}
                  </div>
                </th>
                {!noMetrics ? (
                  <>
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
                      label: renderLabelColumn(row.label, row.metric, row),
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
                                  {renderLabelColumn(
                                    row.label,
                                    row.metric,
                                    row
                                  )}
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
                    const isHovered =
                      hoveredMetricRow === i && hoveredVariationRow === j;

                    const resultsHighlightClassname = clsx(
                      rowResults.resultsStatus,
                      {
                        "non-significant": !rowResults.significant,
                        hover: isHovered,
                      }
                    );

                    const onPointerMove = (
                      e,
                      settings?: TooltipHoverSettings
                    ) => {
                      // No hover tooltip if the screen is too narrow. Clicks still work.
                      if (
                        e?.type === "mousemove" &&
                        (globalThis.window?.innerWidth ?? 900) < 900
                      ) {
                        return;
                      }
                      if (!rowResults.hasData) return;
                      hoverRow(i, j, e, settings);
                    };
                    const onPointerLeave = () => {
                      if (!rowResults.hasData) return;
                      leaveRow();
                    };

                    return (
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
                            renderLabelColumn(row.label, row.metric, row, 3)
                          )}
                        </td>
                        {j > 0 ? (
                          <StatusColumn
                            stats={stats}
                            baseline={baseline}
                            rowResults={rowResults}
                            showPercentComplete={false}
                            showTimeRemaining={true}
                            hideScaledImpact={hideScaledImpact}
                            className={clsx(
                              "results-pval",
                              resultsHighlightClassname
                            )}
                            onMouseMove={onPointerMove}
                            onMouseLeave={onPointerLeave}
                            onClick={onPointerMove}
                          />
                        ) : (
                          <td></td>
                        )}
                        {j > 0 ? (
                          <ChangeColumn
                            metric={row.metric}
                            stats={stats}
                            rowResults={rowResults}
                            differenceType={differenceType}
                            statsEngine={statsEngine}
                            className={resultsHighlightClassname}
                            ssrPolyfills={ssrPolyfills}
                            showPlusMinus={false}
                            onMouseMove={onPointerMove}
                            onMouseLeave={onPointerLeave}
                            onClick={onPointerMove}
                          />
                        ) : (
                          <td></td>
                        )}
                      </tr>
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
