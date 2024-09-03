import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import AlignedGraph from "./AlignedGraph";
import {ExperimentInterfaceStringDates} from "back-end/types/experiment";

export type BanditSummaryTableProps = {
  experiment: ExperimentInterfaceStringDates;
  // variations: ExperimentReportVariation[];
  // rows: ExperimentTableRow[];
  // statsEngine: StatsEngine;
  isTabActive: boolean;
};

const ROW_HEIGHT = 56;

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function BanditSummaryTable({
  experiment,
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

  const variations = experiment.variations.map((v, i) => {
    return {
      id: v.key || i + "",
      index: i,
      name: v.name,
    };
  });
  //
  // const domain = useDomain(variationsWithIndex, rows);
  const lowerBound = -.2;
  const upperBound = .4;
  const domain: [number, number] = [lowerBound, upperBound];

  return (
    <div className="position-relative">
      <div ref={tableContainerRef} className="bandit-summary-results-wrapper">
        <div className="w-100" style={{ minWidth: 500 }}>
          <table id="bandit-summary-results" className="bandit-summary-results table-sm">
            <thead>
              <tr className="results-top-row">
                <th
                  className="axis-col header-label"
                  style={{ width: 280 }}
                >
                  Variation
                </th>
                <th
                  className="axis-col label"
                  style={{ width: 120 }}
                >
                  Mean
                </th>
                <th
                  className="axis-col label"
                  style={{ width: 120 }}
                >
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
                    width:
                      window.innerWidth < 900 ? graphCellWidth : undefined,
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
                return (
                  <tr
                    className="results-variation-row align-items-center"
                    key={j}
                  >
                    <td
                      className={`variation with-variation-label variation${v.index}`}
                      style={{width: 280}}
                    >
                      <div className="d-flex align-items-center">
                              <span
                                className="label ml-1"
                                style={{width: 20, height: 20}}
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
                    <td />
                    <td />
                    <td className="graph-cell">
                      <AlignedGraph
                        id={`bandit-summery-table-axis`}
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
  )
    ;
}
