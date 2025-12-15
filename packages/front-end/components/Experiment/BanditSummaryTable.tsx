import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CSSTransition } from "react-transition-group";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { BanditEvent } from "shared/validators";
import clsx from "clsx";
import { ExperimentMetricInterface } from "shared/experiments";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { getVariationColor } from "@/services/features";
import ResultsVariationsFilter from "@/components/Experiment/ResultsVariationsFilter";
import { useBanditSummaryTooltip } from "@/components/Experiment/BanditSummaryTableTooltip/useBanditSummaryTooltip";
import BanditSummaryTooltip from "@/components/Experiment/BanditSummaryTableTooltip/BanditSummaryTooltip";
import { TooltipHoverSettings } from "@/components/Experiment/ResultsTableTooltip/ResultsTableTooltip";
import { getExperimentMetricFormatter } from "@/services/metrics";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useCurrency } from "@/hooks/useCurrency";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import AlignedGraph from "./AlignedGraph";

export const WIN_THRESHOLD_PROBABILITY = 0.95;
const ROW_HEIGHT = 56;
const ROW_HEIGHT_CONDENSED = 34;

export type BanditSummaryTableProps = {
  experiment: ExperimentInterfaceStringDates;
  metric: ExperimentMetricInterface | null;
  phase: number;
  isTabActive: boolean;
  ssrPolyfills?: SSRPolyfills;
};

const numberFormatter = Intl.NumberFormat();

export default function BanditSummaryTable({
  experiment,
  metric,
  phase,
  isTabActive,
  ssrPolyfills,
}: BanditSummaryTableProps) {
  const _displayCurrency = useCurrency();
  const { getFactTableById: _getFactTableById } = useDefinitions();

  const getFactTableById = ssrPolyfills?.getFactTableById || _getFactTableById;
  const displayCurrency = ssrPolyfills?.useCurrency() || _displayCurrency;
  const metricFormatterOptions = { currency: displayCurrency };

  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const [graphCellWidth, setGraphCellWidth] = useState(800);

  function onResize() {
    if (!tableContainerRef?.current?.clientWidth) return;
    const tableWidth = tableContainerRef.current?.clientWidth as number;
    const firstRowCells = tableContainerRef.current?.querySelectorAll(
      "#bandit-summary-results thead tr:first-child th:not(.graph-cell)",
    );
    let totalCellWidth = 0;
    for (let i = 0; i < firstRowCells.length; i++) {
      totalCellWidth += firstRowCells[i].clientWidth;
    }
    const graphWidth = tableWidth - totalCellWidth;
    setGraphCellWidth(Math.max(graphWidth, 200));
  }

  const phaseObj = experiment.phases[phase];

  const variations = experiment.variations.map((v, i) => {
    return {
      id: v.key || i + "",
      index: i,
      name: v.name,
    };
  });

  const [showVariations, setShowVariations] = useState<boolean[]>(
    variations.map(() => true),
  );
  const [variationsSort, setVariationsSort] = useState<"default" | "ranked">(
    "default",
  );
  const [showVariationsFilter, setShowVariationsFilter] =
    useState<boolean>(false);

  useEffect(() => {
    if (!isTabActive) {
      setShowVariationsFilter(false);
    }
  }, [isTabActive, setShowVariationsFilter]);

  const validEvents: BanditEvent[] =
    phaseObj?.banditEvents?.filter(
      (event) =>
        event.banditResult?.singleVariationResults &&
        !event.banditResult?.error,
    ) || [];
  const currentEvent = validEvents[validEvents.length - 1];
  const results = currentEvent?.banditResult?.singleVariationResults;

  const { probabilities, totalUsers } = useMemo(() => {
    let probabilities: number[] = [];
    let totalUsers = 0;
    for (let i = 0; i < variations.length; i++) {
      let prob =
        currentEvent?.banditResult?.bestArmProbabilities?.[i] ??
        1 / (variations.length || 2);
      if (!results?.[i]) {
        prob = NaN;
      } else {
        const users = results?.[i]?.users ?? 0;
        totalUsers += users;
        if (users < 100) {
          prob = NaN;
        }
      }
      probabilities.push(prob);
    }
    if (totalUsers < 100 * variations.length) {
      probabilities = probabilities.map(() => 1 / (variations.length || 2));
    }
    return { probabilities, totalUsers };
  }, [variations, results, currentEvent]);

  function rankArray(values: (number | undefined)[]): number[] {
    const indices = values
      .map((value, index) => (value !== undefined ? index : -1))
      .filter((index) => index !== -1);
    indices.sort((a, b) => (values[b] as number) - (values[a] as number));
    const ranks = new Array(values.length).fill(0);
    indices.forEach((index, rank) => {
      ranks[index] = rank + 1;
    });
    return ranks;
  }

  const variationRanks = rankArray(probabilities);

  const sortedVariations =
    variationsSort === "default"
      ? variations
      : variations
          .slice()
          .sort((a, b) => variationRanks[a.index] - variationRanks[b.index]);

  const domain: [number, number] = useMemo(() => {
    if (!results) return [-0.1, 0.1];
    const crs = results.map((v) => v.cr).filter(Boolean) as number[];
    const cis = results.map((v) => v.ci).filter(Boolean) as [number, number][];
    let min = Math.min(
      ...cis
        .filter((_, i) => isFinite(probabilities?.[i]))
        .map((ci) => ci[0])
        .filter((ci, j) => !(crs?.[j] === 0 && (ci ?? 0) < -190)),
    );
    let max = Math.max(
      ...cis
        .filter((_, i) => isFinite(probabilities?.[i]))
        .map((ci) => ci[1])
        .filter((ci, j) => !(crs?.[j] === 0 && (ci ?? 0) > 190)),
    );
    if (!isFinite(min) || !isFinite(max)) {
      min = -0.1;
      max = 0.1;
    } else if (min === max) {
      if (min === 0) {
        min = -0.1;
        max = 0.1;
      } else {
        min *= 0.1;
        max *= 0.1;
      }
    }
    return [min, max];
  }, [results, probabilities]);

  const shrinkRows = variations.length > 8;
  const rowHeight = !shrinkRows ? ROW_HEIGHT : ROW_HEIGHT_CONDENSED;

  useEffect(() => {
    window.addEventListener("resize", onResize, false);
    return () => window.removeEventListener("resize", onResize, false);
  }, []);
  useLayoutEffect(onResize, []);
  useEffect(onResize, [isTabActive]);

  const {
    containerRef,
    tooltipOpen,
    tooltipData,
    hoveredX,
    hoveredY,
    hoverRow,
    leaveRow,
    closeTooltip,
    hoveredVariationRow,
    resetTimeout,
  } = useBanditSummaryTooltip({
    metric,
    variations,
    currentEvent,
    probabilities,
    regressionAdjustmentEnabled: experiment.regressionAdjustmentEnabled,
  });

  if (!results) {
    return null;
  }

  return (
    <div className="position-relative" ref={containerRef}>
      <CSSTransition
        key={hoveredVariationRow}
        in={
          tooltipOpen &&
          tooltipData &&
          hoveredX !== null &&
          hoveredY !== null &&
          hoveredVariationRow !== null
        }
        timeout={200}
        classNames="tooltip-animate"
        appear={true}
      >
        <BanditSummaryTooltip
          left={hoveredX ?? 0}
          top={hoveredY ?? 0}
          data={tooltipData}
          tooltipOpen={tooltipOpen}
          close={closeTooltip}
          onPointerMove={resetTimeout}
          onClick={resetTimeout}
          onPointerLeave={leaveRow}
          ssrPolyfills={ssrPolyfills}
        />
      </CSSTransition>

      <div ref={tableContainerRef} className="bandit-summary-results-wrapper">
        <div className="w-100" style={{ minWidth: 500 }}>
          <table
            id="bandit-summary-results"
            className="bandit-summary-results table-sm"
          >
            <thead>
              <tr className="results-top-row">
                <th className="axis-col header-label" style={{ width: 280 }}>
                  <div className="row px-0">
                    <ResultsVariationsFilter
                      variationNames={variations.map((v) => v.name)}
                      variationRanks={variationRanks}
                      showVariations={showVariations}
                      setShowVariations={setShowVariations}
                      variationsSort={variationsSort}
                      setVariationsSort={setVariationsSort}
                      showVariationsFilter={showVariationsFilter}
                      setShowVariationsFilter={setShowVariationsFilter}
                    />
                    <div className="col-auto">Variation</div>
                  </div>
                </th>
                <th
                  className="axis-col label text-center px-0"
                  style={{ width: 120 }}
                >
                  Users
                </th>
                <th
                  className="axis-col label text-center px-0"
                  style={{ width: 120 }}
                >
                  Mean
                </th>
                <th
                  className="axis-col graph-cell"
                  style={{
                    width:
                      (globalThis?.window?.innerWidth ?? 1000) < 900
                        ? graphCellWidth
                        : undefined,
                    minWidth:
                      (globalThis?.window?.innerWidth ?? 1000) >= 900
                        ? graphCellWidth
                        : undefined,
                  }}
                >
                  <div className="position-relative">
                    <AlignedGraph
                      id={`bandit-summery-table-axis`}
                      domain={domain}
                      significant={true}
                      showAxis={true}
                      axisOnly={true}
                      graphWidth={graphCellWidth}
                      percent={false}
                      height={45}
                      metricForFormatting={metric}
                      ssrPolyfills={ssrPolyfills}
                    />
                  </div>
                </th>
              </tr>
            </thead>

            <tbody>
              {sortedVariations.map((v, j) => {
                if (!showVariations?.[v.index]) return null;
                const result = results?.[v.index];
                let stats: SnapshotMetric = {
                  value: NaN,
                  ci: [0, 0],
                  cr: NaN,
                  users: NaN,
                };
                if (result) {
                  stats = {
                    value: (result?.cr ?? 0) * (result?.users ?? 0),
                    ci: result?.ci ?? [0, 0],
                    cr: result?.cr ?? NaN,
                    users: result?.users ?? 0,
                  };
                }
                const meanText = metric
                  ? getExperimentMetricFormatter(metric, getFactTableById)(
                      isFinite(stats.cr) ? stats.cr : 0,
                      metricFormatterOptions,
                    )
                  : (stats.cr ?? 0) + "";
                const probability =
                  probabilities?.[v.index] ?? 1 / (variations.length || 2);

                const won = (probability ?? 0) >= WIN_THRESHOLD_PROBABILITY;

                const isHovered = hoveredVariationRow === v.index;

                const onPointerMove = (e, settings?: TooltipHoverSettings) => {
                  // No hover tooltip if the screen is too narrow. Clicks still work.
                  if (e?.type === "mousemove" && window.innerWidth < 900) {
                    return;
                  }
                  hoverRow(v.index, e, settings);
                };
                const onPointerLeave = () => {
                  leaveRow();
                };

                return (
                  <tr
                    className="results-variation-row align-items-center"
                    key={j}
                  >
                    <td
                      className={`variation with-variation-label variation${v.index}`}
                      style={{ width: 280 }}
                    >
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
                          style={{ width: 225 }}
                        >
                          {v.name}
                        </span>
                      </div>
                    </td>
                    <td className="text-center px-0">
                      {numberFormatter.format(
                        isFinite(stats.users) ? stats.users : 0,
                      )}
                    </td>
                    <td
                      className={clsx(
                        "results-mean value text-center position-relative",
                        {
                          won,
                          hover: isHovered,
                        },
                      )}
                      onMouseMove={onPointerMove}
                      onMouseLeave={onPointerLeave}
                      onClick={onPointerMove}
                    >
                      <span className="position-relative" style={{ zIndex: 1 }}>
                        {isFinite(stats.cr) && stats.users >= 100 ? (
                          meanText
                        ) : (
                          <em className="text-muted">
                            <small>not enough data</small>
                          </em>
                        )}
                      </span>
                      {won && (
                        <div
                          className="position-absolute"
                          style={{
                            bottom: shrinkRows ? 2 : 5,
                            right: 5,
                            opacity: 0.5,
                            fontSize: shrinkRows ? "14px" : "18px",
                            pointerEvents: "none",
                          }}
                        >
                          🎉
                        </div>
                      )}
                    </td>
                    <td className="graph-cell overflow-hidden">
                      <AlignedGraph
                        axisOnly={!isFinite(stats.cr) || stats.users < 100}
                        ci={stats.ci}
                        expected={isFinite(stats.cr) ? stats.cr : 0}
                        barType="violin"
                        barFillType="color"
                        barFillColor={getVariationColor(v.index, true)}
                        id={`bandit-summery-table_violin_${j}`}
                        domain={domain}
                        significant={true}
                        showAxis={false}
                        zeroLineWidth={1.5}
                        zeroLineOffset={0}
                        graphWidth={graphCellWidth}
                        percent={false}
                        height={rowHeight}
                        className={clsx({
                          hover: isHovered,
                        })}
                        isHovered={isHovered}
                        onMouseMove={(e) =>
                          onPointerMove(e, {
                            x: "element-center",
                            targetClassName: "hover-target",
                            offsetY: -8,
                          })
                        }
                        onMouseLeave={onPointerLeave}
                        onClick={(e) =>
                          onPointerMove(e, {
                            x: "element-center",
                            offsetY: -8,
                          })
                        }
                        ssrPolyfills={ssrPolyfills}
                      />
                    </td>
                  </tr>
                );
              })}
              <tr
                key="summary"
                className="results-variation-row bg-light align-items-center"
                style={{ boxShadow: "none" }}
              >
                <td className="font-weight-bold pl-3">All variations</td>
                <td className="text-center px-0 py-2 font-weight-bold">
                  {totalUsers >= 0 ? numberFormatter.format(totalUsers) : null}
                </td>
                <td />
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
