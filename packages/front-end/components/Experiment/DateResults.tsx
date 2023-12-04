import { FC, useMemo, useState } from "react";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "back-end/types/report";
import { getValidDateUTC } from "shared/dates";
import { StatsEngine } from "back-end/types/stats";
import { ExperimentMetricInterface } from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getExperimentMetricFormatter } from "@/services/metrics";
import {
  isExpectedDirection,
  isStatSig,
  shouldHighlight,
} from "@/services/experiments";
import { useCurrency } from "@/hooks/useCurrency";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import Toggle from "../Forms/Toggle";
import ExperimentDateGraph, {
  ExperimentDateGraphDataPoint,
} from "./ExperimentDateGraph";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});
const numberFormatter = new Intl.NumberFormat();

// Represents data for one metric graph
type Metric = {
  metric: ExperimentMetricInterface;
  isGuardrail: boolean;
  datapoints: ExperimentDateGraphDataPoint[];
};

const DateResults: FC<{
  variations: ExperimentReportVariation[];
  results: ExperimentReportResultDimension[];
  seriestype: string;
  metrics: string[];
  guardrails?: string[];
  statsEngine?: StatsEngine;
}> = ({
  results,
  variations,
  seriestype,
  metrics,
  guardrails,
  statsEngine,
}) => {
  const { getExperimentMetricById, getFactTableById, ready } = useDefinitions();

  const pValueThreshold = usePValueThreshold();
  const { ciUpper, ciLower } = useConfidenceLevels();

  const displayCurrency = useCurrency();

  const [cumulativeState, setCumulative] = useState(false);
  let cumulative = cumulativeState;
  if (seriestype != "pre:date") {
    cumulative = false;
  }
  // Get data for users graph
  const users = useMemo<ExperimentDateGraphDataPoint[]>(() => {
    // Keep track of total users per variation for when cumulative is true
    const total: number[] = [];
    const sortedResults = [...results];
    sortedResults.sort((a, b) => {
      return (
        getValidDateUTC(a.name).getTime() - getValidDateUTC(b.name).getTime()
      );
    });

    return sortedResults.map((d) => {
      return {
        d: getValidDateUTC(d.name),
        variations: variations.map((variation, i) => {
          const users = d.variations[i]?.users || 0;
          total[i] = total[i] || 0;
          total[i] += users;
          const v = cumulative ? total[i] : users;
          const v_formatted = v + "";
          return {
            v,
            v_formatted,
            label: numberFormatter.format(v),
          };
        }),
      };
    });
  }, [results, cumulative, variations]);

  // Data for the metric graphs
  const metricSections = useMemo<Metric[]>(() => {
    if (!ready) return [];

    const sortedResults = [...results];
    sortedResults.sort((a, b) => {
      return (
        getValidDateUTC(a.name).getTime() - getValidDateUTC(b.name).getTime()
      );
    });

    // Merge goal and guardrail metrics
    return (
      Array.from(new Set(metrics.concat(guardrails || [])))
        .map((metricId) => {
          const metric = getExperimentMetricById(metricId);
          if (!metric) return;
          // Keep track of cumulative users and value for each variation
          const totalUsers: number[] = [];
          const totalValue: number[] = [];

          const datapoints: ExperimentDateGraphDataPoint[] = sortedResults.map(
            (d) => {
              const baseline = d.variations[0]?.metrics?.[metricId];
              return {
                d: getValidDateUTC(d.name),
                variations: variations.map((variation, i) => {
                  const stats = d.variations[i]?.metrics?.[metricId];
                  const value = stats?.value;
                  const uplift = stats?.uplift;

                  totalUsers[i] = totalUsers[i] || 0;
                  totalValue[i] = totalValue[i] || 0;

                  totalUsers[i] += stats?.users || 0;
                  totalValue[i] += value || 0;

                  const v = value || 0;
                  let ci: [number, number] | undefined = undefined;
                  // Since this is relative uplift, the baseline is a horizontal line at zero
                  let up = 0;
                  // For non-baseline variations and cumulative turned off, include error bars
                  if (i && !cumulative) {
                    const x = uplift?.mean || 0;
                    // const sx = uplift?.stddev || 0;
                    const dist = uplift?.dist || "";
                    ci = stats?.ci;
                    if (dist === "lognormal") {
                      up = Math.exp(x) - 1;
                    } else {
                      up = x;
                    }
                  }
                  // For non-baseline variations and cumulative turned ON, calculate uplift from cumulative data
                  else if (i) {
                    const crA = totalUsers[0]
                      ? totalValue[0] / totalUsers[0]
                      : 0;
                    const crB = totalUsers[i]
                      ? totalValue[i] / totalUsers[i]
                      : 0;
                    up = crA ? (crB - crA) / crA : 0;
                  }

                  const v_formatted = getExperimentMetricFormatter(
                    metric,
                    getFactTableById
                  )(
                    cumulative
                      ? totalUsers[i]
                        ? totalValue[i] / totalUsers[i]
                        : 0
                      : stats?.cr || 0,
                    { currency: displayCurrency }
                  );

                  const p = stats?.pValueAdjusted ?? stats?.pValue ?? 1;
                  const ctw = stats?.chanceToWin;

                  const statSig = isStatSig(p, pValueThreshold);

                  const highlight =
                    !cumulative &&
                    shouldHighlight({
                      metric,
                      baseline,
                      stats,
                      hasEnoughData: true,
                      belowMinChange: false,
                    });

                  let className = "";
                  if (i && highlight) {
                    if (statsEngine === "frequentist" && statSig) {
                      const expectedDirection = isExpectedDirection(
                        stats,
                        metric
                      );
                      if (expectedDirection) {
                        className = "won";
                      } else {
                        className = "lost";
                      }
                    } else if (statsEngine === "bayesian" && ctw) {
                      if (ctw > ciUpper) {
                        className = "won";
                      } else if (ctw < ciLower) {
                        className = "lost";
                      }
                    }
                  }

                  const users = cumulative ? totalUsers[i] : stats?.users || 0;

                  return {
                    v,
                    v_formatted,
                    users,
                    up,
                    ci,
                    p,
                    ctw,
                    className,
                  };
                }),
              };
            }
          );

          return {
            metric,
            isGuardrail: !metrics.includes(metricId),
            datapoints,
          };
        })
        // Filter out any edge cases when the metric is undefined
        .filter((table) => table?.metric) as Metric[]
    );
  }, [
    results,
    cumulative,
    ready,
    ciLower,
    ciUpper,
    displayCurrency,
    getExperimentMetricById,
    getFactTableById,
    guardrails,
    metrics,
    pValueThreshold,
    statsEngine,
    variations,
  ]);

  return (
    <div className="mb-4 mx-3 pb-4">
      {seriestype === "pre:date" && (
        <div className="mb-3 d-flex align-items-center">
          <div className="mr-3">
            <strong>Graph Controls: </strong>
          </div>
          <div>
            <Toggle
              label="Cumulative"
              id="cumulative"
              value={cumulative}
              setValue={setCumulative}
            />
            Cumulative
          </div>
        </div>
      )}
      <div className="mb-5">
        <h2>Users</h2>
        <ExperimentDateGraph
          yaxis="users"
          variationNames={variations.map((v) => v.name)}
          label="Users"
          datapoints={users}
          tickFormat={(v) => numberFormatter.format(v)}
        />
      </div>
      {metricSections && (
        <>
          <h2>Metrics</h2>
          <div className="mb-5">
            <small>
              The following results are cohort effects. In other words, units
              are first grouped by the first date they are exposed to the
              experiment (x-axis) and then the total uplift for all of those
              users is computed (y-axis).
              <br></br>
              This is not the same as a standard time series, because the impact
              on units first exposed on day X could include conversions on
              future days.
            </small>
          </div>
        </>
      )}

      {metricSections.map(({ metric, isGuardrail, datapoints }) => (
        <div className="mb-5" key={metric.id}>
          <h3>
            {metric.name}{" "}
            {isGuardrail && (
              <small className="badge badge-secondary">Guardrail</small>
            )}
          </h3>
          <ExperimentDateGraph
            yaxis="uplift"
            datapoints={datapoints}
            label="Relative Uplift"
            tickFormat={(v) => percentFormatter.format(v)}
            variationNames={variations.map((v) => v.name)}
            statsEngine={statsEngine}
            hasStats={!cumulative}
          />
        </div>
      ))}
    </div>
  );
};
export default DateResults;
