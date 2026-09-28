import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CSSTransition } from "react-transition-group";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { BanditEvent } from "shared/validators";
import clsx from "clsx";
import { Box, Flex } from "@radix-ui/themes";
import {
  ExperimentMetricDefinition,
  getLatestPhaseVariations,
} from "shared/experiments";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { getVariationColor } from "@/services/features";
import ResultsVariationsFilter from "@/components/Experiment/ResultsVariationsFilter";
import { useBanditSummaryTooltip } from "@/components/Experiment/BanditSummaryTableTooltip/useBanditSummaryTooltip";
import BanditSummaryTooltip from "@/components/Experiment/BanditSummaryTableTooltip/BanditSummaryTooltip";
import { TooltipHoverSettings } from "@/components/Experiment/ResultsTableTooltip/ResultsTableTooltip";
import { getExperimentMetricFormatter } from "@/services/metrics";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useIsOverflowingX } from "@/hooks/useIsOverflowing";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import Text from "@/ui/Text";
import VariationLabel from "@/ui/VariationLabel";
import { ROW_HEIGHT } from "@/components/Experiment/ResultsTable";
import AlignedGraph from "./AlignedGraph";

export const WIN_THRESHOLD_PROBABILITY = 0.95;
const ROW_HEIGHT_CONDENSED = 34;

export type BanditSummaryTableProps = {
  experiment: ExperimentInterfaceStringDates;
  metric: ExperimentMetricDefinition | null;
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
  const [cellScale, setCellScale] = useState(1);

  function onResize() {
    if (!tableContainerRef?.current?.clientWidth) return;
    const tableWidth = tableContainerRef.current?.clientWidth as number;
    setCellScale(Math.max(Math.min(1, tableWidth / 1000), 0.7));
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

  const variations = getLatestPhaseVariations(experiment).map((v) => {
    return {
      id: v.key || v.index + "",
      index: v.index,
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
  // The container resizes without the window too, as the details panel opens.
  useEffect(() => {
    if (!tableContainerRef.current) return;
    const resizeObserver = new ResizeObserver(() => onResize());
    resizeObserver.observe(tableContainerRef.current);
    const table = tableContainerRef.current.querySelector("table");
    if (table) resizeObserver.observe(table);
    return () => resizeObserver.disconnect();
  }, []);
  useLayoutEffect(onResize, [cellScale]);
  useEffect(onResize, [isTabActive]);
  const overflowing = useIsOverflowingX(tableContainerRef, !!results);

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

      <div
        ref={tableContainerRef}
        className={clsx("bandit-summary-results-wrapper", { overflowing })}
      >
        <div className="w-100" style={{ minWidth: 500 }}>
          <table
            id="bandit-summary-results"
            className="bandit-summary-results table-sm"
          >
            <thead>
              <tr className="results-top-row">
                <th
                  className="axis-col header-label"
                  style={{ width: 280 * cellScale }}
                >
                  <Flex align="center" gap="2">
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
                    <span>Variation</span>
                  </Flex>
                </th>
                <th
                  className="axis-col label"
                  style={{ width: 120 * cellScale }}
                >
                  Users
                </th>
                <th
                  className="axis-col label"
                  style={{ width: 120 * cellScale }}
                >
                  Mean
                </th>
                <th
                  className="axis-col graph-cell"
                  style={{
                    width:
                      (tableContainerRef?.current?.clientWidth ?? 900) < 900
                        ? graphCellWidth
                        : undefined,
                    minWidth:
                      (tableContainerRef?.current?.clientWidth ?? 900) >= 900
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
                    style={{ height: rowHeight }}
                  >
                    <td
                      className="variation"
                      style={{ width: 280 * cellScale }}
                    >
                      <Box pl="5">
                        <VariationLabel
                          number={v.index}
                          name={v.name}
                          size="md"
                        />
                      </Box>
                    </td>
                    <td className="value">
                      {numberFormatter.format(
                        isFinite(stats.users) ? stats.users : 0,
                      )}
                    </td>
                    <td
                      className={clsx("results-mean value", {
                        won,
                        hover: isHovered,
                      })}
                      onMouseMove={onPointerMove}
                      onMouseLeave={onPointerLeave}
                      onClick={onPointerMove}
                    >
                      {isFinite(stats.cr) && stats.users >= 100 ? (
                        meanText
                      ) : (
                        <Text size="sm" color="text-low" fontStyle="italic">
                          Not enough data
                        </Text>
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
                className="results-variation-row align-items-center"
                style={{ height: rowHeight }}
              >
                <td>
                  <Box pl="5">
                    <Text weight="medium" color="text-mid">
                      All variations
                    </Text>
                  </Box>
                </td>
                <td className="value">
                  <Text weight="medium">
                    {totalUsers >= 0
                      ? numberFormatter.format(totalUsers)
                      : null}
                  </Text>
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
