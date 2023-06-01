import { FC, useMemo, useState } from "react";
import { MetricInterface } from "back-end/types/metric";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "back-end/types/report";
import { getValidDate } from "shared/dates";
import { StatsEngine } from "back-end/types/stats";
import { useDefinitions } from "@/services/DefinitionsContext";
import { formatConversionRate } from "@/services/metrics";
import {
  hasEnoughData,
  isBelowMinChange,
  isSuspiciousUplift,
  shouldHighlight,
} from "@/services/experiments";
import { useCurrency } from "@/hooks/useCurrency";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
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
  metric: MetricInterface;
  isGuardrail: boolean;
  datapoints: ExperimentDateGraphDataPoint[];
};

const DateResults: FC<{
  variations: ExperimentReportVariation[];
  results: ExperimentReportResultDimension[];
  metrics: string[];
  guardrails?: string[];
  statsEngine?: StatsEngine;
}> = ({ results, variations, metrics, guardrails, statsEngine }) => {
  const { getMetricById, ready } = useDefinitions();
  const { metricDefaults } = useOrganizationMetricDefaults();
  const displayCurrency = useCurrency();

  const [cumulative, setCumulative] = useState(false);

  // Get data for users graph
  const users = useMemo<ExperimentDateGraphDataPoint[]>(() => {
    // Keep track of total users per variation for when cumulative is true
    const total: number[] = [];
    const sortedResults = [...results];
    sortedResults.sort((a, b) => {
      return getValidDate(a.name).getTime() - getValidDate(b.name).getTime();
    });

    return sortedResults.map((d) => {
      return {
        d: getValidDate(d.name),
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
  }, [results, cumulative]);

  // Data for the metric graphs
  const metricSections = useMemo<Metric[]>(() => {
    if (!ready) return [];

    const sortedResults = [...results];
    sortedResults.sort((a, b) => {
      return getValidDate(a.name).getTime() - getValidDate(b.name).getTime();
    });

    // Merge goal and guardrail metrics
    return (
      Array.from(new Set(metrics.concat(guardrails || [])))
        .map((metricId) => {
          const metric = getMetricById(metricId);
          if (!metric) return;
          // Keep track of cumulative users and value for each variation
          const totalUsers: number[] = [];
          const totalValue: number[] = [];

          const datapoints: ExperimentDateGraphDataPoint[] = sortedResults.map(
            (d) => {
              const baseline = d.variations[0]?.metrics?.[metricId];
              return {
                d: getValidDate(d.name),
                variations: variations.map((variation, i) => {
                  const stats = d.variations[i]?.metrics?.[metricId];
                  const value = stats?.value;
                  const uplift = stats?.uplift;

                  totalUsers[i] = totalUsers[i] || 0;
                  totalValue[i] = totalValue[i] || 0;

                  totalUsers[i] += stats?.users || 0;
                  totalValue[i] += stats?.value || 0;

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
                      // Uplift distribution is lognormal, so need to correct this
                      // Add 2 standard deviations (~95% CI) for an error bar
                      // if (!ci) {
                      //   ci = [
                      //     Math.exp(x - 2 * sx) - 1,
                      //     Math.exp(x + 2 * sx) - 1,
                      //   ];
                      // }
                      up = Math.exp(x) - 1;
                    } else {
                      // if (!ci) {
                      //   ci = [x - 2 * sx, x + 2 * sx];
                      // }
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

                  const v_formatted = formatConversionRate(
                    metric?.type,
                    cumulative
                      ? totalUsers[i]
                        ? totalValue[i] / totalUsers[i]
                        : 0
                      : stats?.cr || 0,
                    displayCurrency
                  );

                  const p = stats?.pValueAdjusted ?? stats?.pValue;
                  const ctw = hasEnoughData(
                    baseline,
                    stats,
                    metric,
                    metricDefaults
                  )
                    ? stats?.chanceToWin
                    : undefined;

                  const suspiciousChange = isSuspiciousUplift(
                    baseline,
                    stats,
                    metric,
                    metricDefaults
                  );
                  const belowMinChange = isBelowMinChange(
                    baseline,
                    stats,
                    metric,
                    metricDefaults
                  );
                  const enoughData = hasEnoughData(
                    baseline,
                    stats,
                    metric,
                    metricDefaults
                  );
                  const highlight = shouldHighlight({
                    metric,
                    baseline,
                    stats,
                    hasEnoughData: enoughData,
                    suspiciousChange,
                    belowMinChange,
                  });

                  return {
                    v,
                    v_formatted,
                    up,
                    ci,
                    p,
                    ctw,
                    highlight,
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
  }, [results, cumulative, ready]);

  return (
    <div className="mb-4 mx-3 pb-4">
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
      <div className="mb-5">
        <h3>Users</h3>
        <ExperimentDateGraph
          yaxis="users"
          variationNames={variations.map((v) => v.name)}
          label="Users"
          datapoints={users}
          tickFormat={(v) => numberFormatter.format(v)}
        />
      </div>
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
          />
        </div>
      ))}
    </div>
  );
};
export default DateResults;
