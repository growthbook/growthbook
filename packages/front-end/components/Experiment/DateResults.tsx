import { FC, useMemo, useState } from "react";
import { MetricInterface } from "back-end/types/metric";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "back-end/types/report";
import { useDefinitions } from "@/services/DefinitionsContext";
import { formatConversionRate } from "@/services/metrics";
import { getValidDate } from "@/services/dates";
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
}> = ({ results, variations, metrics, guardrails }) => {
  const { getMetricById, ready } = useDefinitions();

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
        variations: variations.map((v, i) => {
          const users = d.variations[i]?.users || 0;
          total[i] = total[i] || 0;
          total[i] += users;
          const value = cumulative ? total[i] : users;
          return {
            value,
            label: numberFormatter.format(value),
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
          // Keep track of cumulative users and value for each variation
          const totalUsers: number[] = [];
          const totalValue: number[] = [];

          const datapoints = sortedResults.map((d) => {
            return {
              d: getValidDate(d.name),
              variations: variations.map((v, i) => {
                const stats = d.variations[i]?.metrics?.[metricId];
                const uplift = stats?.uplift;

                totalUsers[i] = totalUsers[i] || 0;
                totalValue[i] = totalValue[i] || 0;

                totalUsers[i] += stats?.users || 0;
                totalValue[i] += stats?.value || 0;

                let error: [number, number] | undefined = undefined;
                // Since this is relative uplift, the baseline is a horizontal line at zero
                let value = 0;
                // For non-baseline variations and cumulative turned off, include error bars
                if (i && !cumulative) {
                  const x = uplift?.mean || 0;
                  const sx = uplift?.stddev || 0;
                  // Uplift distribution is lognormal, so need to correct this
                  // Add 2 standard deviations (~95% CI) for an error bar
                  error = [Math.exp(x - 2 * sx) - 1, Math.exp(x + 2 * sx) - 1];
                  value = Math.exp(x) - 1;
                }
                // For non-baseline variations and cumulative turned ON, calculate uplift from cumulative data
                else if (i) {
                  const crA = totalUsers[0] ? totalValue[0] / totalUsers[0] : 0;
                  const crB = totalUsers[i] ? totalValue[i] / totalUsers[i] : 0;
                  value = crA ? (crB - crA) / crA : 0;
                }

                // Baseline should show the actual conversion rate
                // Variations should show the relative uplift on top of this conversion rate
                const label = i
                  ? (value > 0 ? "+" : "") + percentFormatter.format(value)
                  : formatConversionRate(
                      metric?.type,
                      cumulative
                        ? totalUsers[i]
                          ? totalValue[i] / totalUsers[i]
                          : 0
                        : stats?.cr || 0
                    );

                return {
                  value,
                  label,
                  error,
                };
              }),
            };
          });

          return {
            metric,
            isGuardrail: !metrics.includes(metricId),
            datapoints,
          };
        })
        // Filter out any edge cases when the metric is undefined
        .filter((table) => table.metric)
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
          datapoints={users}
          label="Users"
          tickFormat={(v) => numberFormatter.format(v)}
          variationNames={variations.map((v) => v.name)}
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
            datapoints={datapoints}
            label="Relative Uplift"
            tickFormat={(v) => percentFormatter.format(v)}
            variationNames={variations.map((v) => v.name)}
          />
        </div>
      ))}
    </div>
  );
};
export default DateResults;
