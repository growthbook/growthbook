import {useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import AlignedGraph from "./AlignedGraph";
import { BanditEvent } from "back-end/src/validators/experiments";
import clsx from "clsx";
import {MetricInterface} from "back-end/types/metric";
import MetricValueColumn from "@/components/Experiment/MetricValueColumn";
import {SnapshotMetric} from "back-end/types/experiment-snapshot";
import {getVariationColor} from "@/services/features";

export type BanditSummaryTableProps = {
  experiment: ExperimentInterfaceStringDates;
  metric: MetricInterface | null;
  // variations: ExperimentReportVariation[];
  // rows: ExperimentTableRow[];
  // statsEngine: StatsEngine;
  isTabActive: boolean;
};

const ROW_HEIGHT = 56;

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

export default function BanditSummaryTable({
  experiment,
  metric,
  // variations,
  // rows,
  // statsEngine,
  isTabActive,
}: BanditSummaryTableProps) {
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const [graphCellWidth, setGraphCellWidth] = useState(800);

  function onResize() {
    if (!tableContainerRef?.current?.clientWidth) return;
    const tableWidth = tableContainerRef.current?.clientWidth as number;
    const firstRowCells = tableContainerRef.current?.querySelectorAll(
      "#bandit-summary-results thead tr:first-child th:not(.graph-cell)"
    );
    let totalCellWidth = 0;
    for (let i = 0; i < firstRowCells.length; i++) {
      totalCellWidth += firstRowCells[i].clientWidth;
    }
    const graphWidth = tableWidth - totalCellWidth;
    setGraphCellWidth(Math.max(graphWidth, 200));
  }

  useEffect(() => {
    window.addEventListener("resize", onResize, false);
    return () => window.removeEventListener("resize", onResize, false);
  }, []);
  useLayoutEffect(onResize, []);
  useEffect(onResize, [isTabActive]);

  const phase = experiment.phases[experiment.phases.length -1];

  const variations = experiment.variations.map((v, i) => {
    return {
      id: v.key || i + "",
      index: i,
      name: v.name,
    };
  });

  const validEvents: BanditEvent[] = phase?.banditEvents?.filter((event) => event.banditResult?.singleVariationResults && !event.banditResult?.error) || [];
  const results = validEvents[validEvents.length - 1]?.banditResult?.singleVariationResults;
  const probabilities = validEvents[validEvents.length - 1]?.banditResult?.bestArmProbabilities;
  if (!results) {
    return null;
  }

  const domain: [number, number] = useMemo(() => {
    const cis = results.map(v => v.ci).filter(Boolean) as [number, number][];
    const min = Math.min(...cis.map(ci => ci[0]));
    const max = Math.max(...cis.map(ci => ci[1]));
    return [min, max];
  }, [results]);

  // const domain = useDomain(variationsWithIndex, rows);
  // const lowerBound = -0.2;
  // const upperBound = 0.4;
  // const domain: [number, number] = [lowerBound, upperBound];

  return (
    <div className="position-relative">
      <div ref={tableContainerRef} className="bandit-summary-results-wrapper">
        <div className="w-100" style={{ minWidth: 500 }}>
          <table
            id="bandit-summary-results"
            className="bandit-summary-results table-sm"
          >
            <thead>
              <tr className="results-top-row">
                <th className="axis-col header-label" style={{ width: 280 }}>
                  Variation
                </th>
                <th className="axis-col label" style={{ width: 120 }}>
                  Mean
                </th>
                <th className="axis-col label" style={{ width: 120 }}>
                  <div
                    style={{
                      lineHeight: "15px",
                      marginBottom: 2,
                    }}
                  >
                    <span className="nowrap">Chance to</span>{" "}
                    <span className="nowrap">be Best</span>
                  </div>
                </th>
                <th
                  className="axis-col graph-cell"
                  style={{
                    width: window.innerWidth < 900 ? graphCellWidth : undefined,
                    minWidth:
                      window.innerWidth >= 900 ? graphCellWidth : undefined,
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
                    />
                  </div>
                </th>
              </tr>
            </thead>

            <tbody>
              {variations.map((v, j) => {
                const result = results[j];
                // @ts-ignore
                const stats: SnapshotMetric = { ...result, value: result.cr * result.users };
                const probability = probabilities?.[j];
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
                    {metric ? (
                      <MetricValueColumn
                        metric={metric}
                        stats={stats}
                        users={stats.users}
                        className="value"
                      />
                    ): <td />}
                    <td className={clsx("results-ctw chance", {
                      won: probability === Math.max(...(probabilities ?? []))
                    })}>
                      {percentFormatter.format(probability ?? 0)}
                    </td>
                    <td className="graph-cell">
                      <AlignedGraph
                        ci={result.ci}
                        expected={result.cr}
                        barType="violin"
                        barFillType="color"
                        barFillColor={getVariationColor(j, true)}
                        id={`bandit-summery-table_violin_${j}`}
                        domain={domain}
                        significant={true}
                        showAxis={false}
                        graphWidth={graphCellWidth}
                        percent={false}
                        height={ROW_HEIGHT}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
