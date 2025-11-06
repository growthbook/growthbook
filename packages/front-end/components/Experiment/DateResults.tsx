import { FC, useMemo, useState } from "react";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "back-end/types/report";
import { getValidDate, getValidDateOffsetByUTC } from "shared/dates";
import {
  expandMetricGroups,
  ExperimentMetricInterface,
  isExpectedDirection,
  isStatSig,
  quantileMetricType,
  shouldHighlight,
} from "shared/experiments";
import { DifferenceType, StatsEngine } from "back-end/types/stats";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  formatNumber,
  formatPercent,
  getExperimentMetricFormatter,
} from "@/services/metrics";
import { getEffectLabel } from "@/services/experiments";
import { useCurrency } from "@/hooks/useCurrency";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import Switch from "@/ui/Switch";
import { getMetricResultGroup } from "@/hooks/useExperimentDimensionRows";
import Tooltip from "@/ui/Tooltip";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import Badge from "@/ui/Badge";
import ExperimentDateGraph, {
  ExperimentDateGraphDataPoint,
} from "./ExperimentDateGraph";

const numberFormatter = new Intl.NumberFormat();

// Represents data for one metric graph
type Metric = {
  metric: ExperimentMetricInterface;
  resultGroup: "goal" | "secondary" | "guardrail";
  datapoints: ExperimentDateGraphDataPoint[];
};

const DateResults: FC<{
  variations: ExperimentReportVariation[];
  results: ExperimentReportResultDimension[];
  seriestype: string;
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  statsEngine?: StatsEngine;
  differenceType?: DifferenceType;
  ssrPolyfills?: SSRPolyfills;
}> = ({
  results,
  variations,
  seriestype,
  goalMetrics,
  secondaryMetrics,
  guardrailMetrics,
  statsEngine,
  differenceType,
  ssrPolyfills,
}) => {
  const { getExperimentMetricById, getFactTableById, metricGroups, ready } =
    useDefinitions();

  const _confidenceLevels = useConfidenceLevels();
  const _pValueThreshold = usePValueThreshold();
  const _displayCurrency = useCurrency();

  const { ciUpper, ciLower } =
    ssrPolyfills?.useConfidenceLevels?.() || _confidenceLevels;
  const pValueThreshold =
    ssrPolyfills?.usePValueThreshold?.() || _pValueThreshold;
  const displayCurrency = ssrPolyfills?.useCurrency?.() || _displayCurrency;

  const [cumulativeState, setCumulative] = useState(false);
  let cumulative = cumulativeState;
  // eventually we could store or back out the scaling factor
  // to allow cumulative for scaled impact, but it is low
  // value at the moment
  const disabledCumulative = differenceType === "scaled";
  if (seriestype != "pre:date" || disabledCumulative) {
    cumulative = false;
  }
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
        d: getValidDateOffsetByUTC(d.name),
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

  const { expandedGoals, expandedSecondaries, expandedGuardrails } =
    useMemo(() => {
      const expandedGoals = expandMetricGroups(
        goalMetrics,
        ssrPolyfills?.metricGroups || metricGroups,
      );
      const expandedSecondaries = expandMetricGroups(
        secondaryMetrics,
        ssrPolyfills?.metricGroups || metricGroups,
      );
      const expandedGuardrails = expandMetricGroups(
        guardrailMetrics,
        ssrPolyfills?.metricGroups || metricGroups,
      );

      return { expandedGoals, expandedSecondaries, expandedGuardrails };
    }, [
      goalMetrics,
      metricGroups,
      ssrPolyfills?.metricGroups,
      secondaryMetrics,
      guardrailMetrics,
    ]);

  // Data for the metric graphs
  const metricSections = useMemo<Metric[]>(() => {
    if (!ready && !ssrPolyfills) return [];

    const sortedResults = [...results];
    sortedResults.sort((a, b) => {
      return getValidDate(a.name).getTime() - getValidDate(b.name).getTime();
    });

    // Merge goal and guardrail metrics
    return (
      Array.from(
        new Set(
          expandedGoals.concat(expandedSecondaries).concat(expandedGuardrails),
        ),
      )
        .map((metricId) => {
          const metric =
            ssrPolyfills?.getExperimentMetricById?.(metricId) ||
            getExperimentMetricById(metricId);

          if (!metric) return;
          // Keep track of cumulative users and value for each variation
          const totalUsers: number[] = [];
          const totalValue: number[] = [];
          const totalDenominator: number[] = [];

          const datapoints: ExperimentDateGraphDataPoint[] = sortedResults.map(
            (d) => {
              const baseline = d.variations[0]?.metrics?.[metricId];
              return {
                d: getValidDateOffsetByUTC(d.name),
                variations: variations.map((variation, i) => {
                  const stats = d.variations[i]?.metrics?.[metricId];
                  const value = stats?.value;
                  const uplift = stats?.uplift;

                  totalUsers[i] = totalUsers[i] || 0;
                  totalValue[i] = totalValue[i] || 0;
                  totalDenominator[i] = totalDenominator[i] || 0;

                  totalUsers[i] += stats?.users || 0;
                  totalValue[i] += value || 0;
                  totalDenominator[i] +=
                    stats?.denominator || stats?.users || 0;

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
                    const crA = totalDenominator[0]
                      ? totalValue[0] / totalDenominator[0]
                      : 0;
                    const crB = totalDenominator[i]
                      ? totalValue[i] / totalDenominator[i]
                      : 0;
                    if (differenceType === "absolute") {
                      up = crB - crA;
                    } else {
                      up = crA ? (crB - crA) / crA : 0;
                    }
                  }

                  const v_formatted = getExperimentMetricFormatter(
                    metric,
                    ssrPolyfills?.getFactTableById || getFactTableById,
                  )(
                    cumulative
                      ? totalDenominator[i]
                        ? totalValue[i] / totalDenominator[i]
                        : 0
                      : stats?.cr || 0,
                    { currency: displayCurrency },
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
                        metric,
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
            },
          );

          return {
            metric,
            resultGroup: getMetricResultGroup(
              metric.id,
              expandedGoals,
              expandedSecondaries,
            ),
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
    expandedGuardrails,
    expandedGoals,
    expandedSecondaries,
    pValueThreshold,
    differenceType,
    statsEngine,
    variations,
    ssrPolyfills,
  ]);

  const metricFormatterOptions: Intl.NumberFormatOptions = {
    currency: displayCurrency,
    ...(differenceType === "relative" ? { maximumFractionDigits: 1 } : {}),
    ...(differenceType === "scaled" ? { notation: "compact" } : {}),
  };

  return (
    <div className="mb-4 mx-3 pb-4">
      {seriestype === "pre:date" && (
        <div className="mb-3 d-flex align-items-center">
          <div className="mr-3">
            <strong>Graph Controls: </strong>
          </div>
          <div>
            <Tooltip
              content="Cumulative charts disabled for Scaled Impact difference type"
              enabled={differenceType === "scaled"}
            >
              <Switch
                id="cumulative"
                label="Cumulative"
                value={cumulative}
                onChange={setCumulative}
                disabled={differenceType === "scaled"}
              />
            </Tooltip>
          </div>
        </div>
      )}
      <div className="mb-5">
        <h2>Units</h2>
        <ExperimentDateGraph
          yaxis="users"
          variationNames={variations.map((v) => v.name)}
          label="Units"
          datapoints={users}
          formatter={formatNumber}
          cumulative={cumulative}
        />
      </div>
      {metricSections && (
        <>
          <h2>Metrics</h2>
          <div className="mb-4">
            <small>
              The following results are cohort effects. In other words, units
              are first grouped by the first date they are exposed to the
              experiment (x-axis) and then the total uplift for all of those
              users is computed (y-axis). This is not the same as a standard
              time series, because the impact on units first exposed on day X
              could include conversions on future days.
            </small>
          </div>
        </>
      )}

      {metricSections.map(({ metric, resultGroup, datapoints }) => (
        <div className="mb-5" key={metric.id}>
          <h3>
            {metric.name}{" "}
            {resultGroup !== "goal" && (
              <Badge color="gray" label={resultGroup} />
            )}
          </h3>
          {!quantileMetricType(metric) || !cumulative ? (
            <ExperimentDateGraph
              yaxis="effect"
              datapoints={datapoints}
              label={getEffectLabel(differenceType ?? "relative")}
              formatter={
                differenceType === "relative"
                  ? formatPercent
                  : getExperimentMetricFormatter(
                      metric,
                      getFactTableById,
                      differenceType === "absolute"
                        ? "percentagePoints"
                        : "number",
                    )
              }
              formatterOptions={metricFormatterOptions}
              variationNames={variations.map((v) => v.name)}
              statsEngine={statsEngine}
              hasStats={!cumulative}
            />
          ) : (
            <>No cumulative graph available for quantile metrics</>
          )}
        </div>
      ))}
    </div>
  );
};
export default DateResults;
