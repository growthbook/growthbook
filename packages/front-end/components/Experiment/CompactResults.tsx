import React, { FC } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import {
  formatConversionRate,
  defaultWinRiskThreshold,
  defaultLoseRiskThreshold,
  defaultMaxPercentChange,
  defaultMinPercentChange,
  defaultMinSampleSize,
} from "../../services/metrics";
import clsx from "clsx";
import {
  ExperimentSnapshotInterface,
  SnapshotMetric,
  SnapshotVariation,
} from "back-end/types/experiment-snapshot";
import { useDefinitions } from "../../services/DefinitionsContext";
import AlignedGraph from "./AlignedGraph";
import { formatDistance } from "date-fns";
import { MdSwapCalls } from "react-icons/md";
import Tooltip from "../Tooltip";
import useConfidenceLevels from "../../hooks/useConfidenceLevels";
import { FaQuestionCircle } from "react-icons/fa";
import { useState } from "react";
import DataQualityWarning from "./DataQualityWarning";
import { MetricInterface } from "back-end/types/metric";
import MetricValueColumn from "./MetricValueColumn";

const numberFormatter = new Intl.NumberFormat();
const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

function hasEnoughData(
  baseline: SnapshotMetric,
  stats: SnapshotMetric,
  metric: MetricInterface
): boolean {
  if (!baseline?.value || !stats?.value) return false;

  const minSampleSize = metric.minSampleSize || defaultMinSampleSize;

  return Math.max(baseline.value, stats.value) >= minSampleSize;
}

function isSuspiciousUplift(
  baseline: SnapshotMetric,
  stats: SnapshotMetric,
  metric: MetricInterface
): boolean {
  if (!baseline?.cr || !stats?.cr) return false;

  const maxPercentChange = metric.maxPercentChange || defaultMaxPercentChange;

  return Math.abs(baseline.cr - stats.cr) / baseline.cr >= maxPercentChange;
}

function isBelowMinChange(
  baseline: SnapshotMetric,
  stats: SnapshotMetric,
  metric: MetricInterface
): boolean {
  if (!baseline?.cr || !stats?.cr) return false;

  const minPercentChange = metric.minPercentChange || defaultMinPercentChange;

  return Math.abs(baseline.cr - stats.cr) / baseline.cr < minPercentChange;
}

function getRisk(
  riskVariation: number,
  metric: MetricInterface,
  variations: SnapshotVariation[]
) {
  const m = metric?.id;
  let risk: number;
  let riskCR: number;
  let relativeRisk: number;
  let showRisk = false;
  let belowMinChange = false;
  const baseline = variations[0]?.metrics?.[m];

  if (riskVariation > 0) {
    const stats = variations[riskVariation]?.metrics?.[m];
    risk = stats?.risk?.[metric?.inverse ? 0 : 1];
    riskCR = stats?.cr;
    showRisk =
      risk !== null &&
      riskCR > 0 &&
      hasEnoughData(baseline, stats, metric) &&
      !isSuspiciousUplift(baseline, stats, metric);
    belowMinChange = isBelowMinChange(baseline, stats, metric);
  } else {
    risk = -1;
    variations.forEach((v, i) => {
      if (!i) return;
      const stats = v.metrics[m];
      if (!hasEnoughData(baseline, stats, metric)) {
        return;
      }
      if (isSuspiciousUplift(baseline, stats, metric)) {
        return;
      }
      belowMinChange = isBelowMinChange(baseline, stats, metric);

      const vRisk = stats?.risk?.[metric?.inverse ? 1 : 0];
      if (vRisk > risk) {
        risk = vRisk;
        riskCR = stats?.cr;
      }
    });
    showRisk = risk >= 0 && riskCR > 0;
  }
  if (showRisk) {
    relativeRisk = risk / riskCR;
  }

  return {
    risk,
    relativeRisk,
    showRisk,
    belowMinChange,
  };
}

function NotEnoughData({
  phaseStart,
  snapshotCreated,
  experimentStatus,
  isLatestPhase,
  minSampleSize,
  variationValue,
  baselineValue,
}: {
  snapshotCreated: Date;
  phaseStart: string;
  experimentStatus: "draft" | "running" | "stopped";
  isLatestPhase: boolean;
  minSampleSize: number;
  variationValue: number;
  baselineValue: number;
}) {
  const percentComplete = Math.min(
    Math.max(variationValue, baselineValue) / minSampleSize
  );

  const snapshotCreatedTime = new Date(snapshotCreated).getTime();

  const msRemaining =
    percentComplete > 0.1
      ? ((snapshotCreatedTime - new Date(phaseStart).getTime()) *
          (1 - percentComplete)) /
          percentComplete -
        (Date.now() - snapshotCreatedTime)
      : null;

  const showTimeRemaining =
    msRemaining !== null && isLatestPhase && experimentStatus === "running";

  return (
    <div>
      <div className="mb-1">
        <div className="badge badge-pill badge-secondary">not enough data</div>
      </div>
      {showTimeRemaining && (
        <small className="text-muted">
          {msRemaining > 0 ? (
            <>
              <span className="nowrap">{formatDistance(0, msRemaining)}</span>{" "}
              left
            </>
          ) : (
            "try updating now"
          )}
        </small>
      )}
    </div>
  );
}

function ChanceToWinColumn({
  metric,
  experiment,
  phase,
  snapshotDate,
  baseline,
  stats,
}: {
  metric: MetricInterface;
  experiment: ExperimentInterfaceStringDates;
  phase: number;
  snapshotDate: Date;
  baseline: SnapshotMetric;
  stats: SnapshotMetric;
}) {
  const minSampleSize = metric?.minSampleSize || defaultMinSampleSize;
  const enoughData = hasEnoughData(baseline, stats, metric);
  const suspiciousChange = isSuspiciousUplift(baseline, stats, metric);
  const belowMinChange = isBelowMinChange(baseline, stats, metric);
  const { ciUpper, ciLower } = useConfidenceLevels();

  const shouldHighlight =
    metric &&
    baseline?.value &&
    stats?.value &&
    enoughData &&
    !suspiciousChange &&
    !belowMinChange;

  const chanceToWin = stats?.chanceToWin ?? 0;

  return (
    <td
      className={clsx("variation chance result-number align-middle", {
        won: shouldHighlight && chanceToWin > ciUpper,
        lost: shouldHighlight && chanceToWin < ciLower,
        draw:
          belowMinChange && (chanceToWin > ciUpper || chanceToWin < ciLower),
      })}
    >
      {!baseline?.value || !stats?.value ? (
        <em>no data</em>
      ) : !enoughData ? (
        <NotEnoughData
          experimentStatus={experiment.status}
          isLatestPhase={phase === experiment.phases.length - 1}
          baselineValue={baseline?.value}
          variationValue={stats?.value}
          minSampleSize={minSampleSize}
          snapshotCreated={snapshotDate}
          phaseStart={experiment.phases[phase]?.dateStarted}
        />
      ) : suspiciousChange ? (
        <div>
          <div className="mb-1">
            <span className="badge badge-pill badge-warning">
              suspicious result
            </span>
          </div>
          <small className="text-muted">value changed too much</small>
        </div>
      ) : (
        percentFormatter.format(chanceToWin)
      )}
    </td>
  );
}

function PercentGraphColumn({
  metric,
  experiment,
  variation,
  baseline,
  stats,
  domain,
}: {
  metric: MetricInterface;
  experiment: ExperimentInterfaceStringDates;
  variation: number;
  baseline: SnapshotMetric;
  stats: SnapshotMetric;
  domain: [number, number];
}) {
  const enoughData = hasEnoughData(baseline, stats, metric);
  const suspiciousChange = isSuspiciousUplift(baseline, stats, metric);
  const { ciUpper, ciLower } = useConfidenceLevels();
  const barType = stats.uplift?.dist ? "violin" : "pill";

  const showGraph = metric && enoughData && !suspiciousChange;
  return (
    <td className="compact-graph pb-0 align-middle">
      <AlignedGraph
        ci={showGraph ? stats.ci || [] : [0, 0]}
        id={experiment.id + "_" + variation + "_" + metric?.id}
        domain={domain}
        uplift={showGraph ? stats.uplift : null}
        expected={showGraph ? stats.expected : null}
        barType={barType}
        barFillType="gradient"
        axisOnly={showGraph ? false : true}
        showAxis={false}
        significant={
          showGraph
            ? stats.chanceToWin > ciUpper || stats.chanceToWin < ciLower
            : false
        }
        height={75}
        inverse={!!metric?.inverse}
      />
    </td>
  );
}

function RiskColumn({
  metric,
  baselineValue,
  variations,
  riskVariation,
}: {
  metric: MetricInterface;
  baselineValue: number;
  variations: SnapshotVariation[];
  riskVariation: number;
}) {
  const { relativeRisk, risk, showRisk, belowMinChange } = getRisk(
    riskVariation,
    metric,
    variations
  );

  const winRiskThreshold = metric?.winRisk || defaultWinRiskThreshold;
  const loseRiskThreshold = metric?.loseRisk || defaultLoseRiskThreshold;

  if (!baselineValue || !showRisk) {
    return <td className="empty-td"></td>;
  }

  return (
    <td
      className={clsx("chance variation align-middle", {
        won: !belowMinChange && showRisk && relativeRisk <= winRiskThreshold,
        lost: !belowMinChange && showRisk && relativeRisk >= loseRiskThreshold,
        draw:
          belowMinChange &&
          (relativeRisk >= loseRiskThreshold ||
            relativeRisk <= winRiskThreshold),
        warning:
          !belowMinChange &&
          showRisk &&
          relativeRisk > winRiskThreshold &&
          relativeRisk < loseRiskThreshold,
      })}
    >
      <div className="result-number">
        {percentFormatter.format(relativeRisk)}
      </div>
      {metric?.type !== "binomial" && (
        <div>
          <small className="text-muted">
            <em>
              {formatConversionRate(metric?.type, risk)}
              &nbsp;/&nbsp;user
            </em>
          </small>
        </div>
      )}
    </td>
  );
}

function useRiskVariation(
  experiment: ExperimentInterfaceStringDates,
  variations: SnapshotVariation[]
) {
  const { getMetricById } = useDefinitions();
  const [riskVariation, setRiskVariation] = useState(() => {
    // Calculate the total risk for each variation across all metrics
    const sums: number[] = Array(variations.length).fill(0);
    experiment.metrics.forEach((m) => {
      const metric = getMetricById(m);
      if (!metric) return;

      const baseline = variations[0].metrics[m];
      if (!baseline || !baseline.cr) return;

      let controlMax = 0;
      variations.forEach((v, i) => {
        if (!i) return;
        const stats = variations[i].metrics[m];

        if (!stats || !stats.risk || !stats.cr) {
          return;
        }
        if (!hasEnoughData(baseline, stats, metric)) {
          return;
        }
        if (isSuspiciousUplift(baseline, stats, metric)) {
          return;
        }

        const controlRisk =
          (metric?.inverse ? stats.risk[1] : stats.risk[0]) / baseline.cr;

        controlMax = Math.max(controlMax, controlRisk);
        sums[i] += (metric?.inverse ? stats.risk[0] : stats.risk[1]) / stats.cr;
      });
      sums[0] += controlMax;
    });

    // Default to the variation with the lowest total risk
    return sums.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])[0][1];
  });

  const hasRisk =
    Object.values(variations[1]?.metrics || {}).filter(
      (x) => x.risk?.length > 0
    ).length > 0;

  return [hasRisk, riskVariation, setRiskVariation] as const;
}

function useDomain(
  experiment: ExperimentInterfaceStringDates,
  variations: SnapshotVariation[]
): [number, number] {
  const { getMetricById } = useDefinitions();

  let lowerBound: number, upperBound: number;
  experiment.metrics?.forEach((m) => {
    const metric = getMetricById(m);
    if (!metric) return;

    const baseline = variations[0].metrics[m];

    experiment.variations?.forEach((v, i) => {
      if (!variations[i]?.metrics?.[m]) return;
      const stats = { ...variations[i].metrics[m] };

      // Skip baseline
      if (!i) return;
      if (!hasEnoughData(baseline, stats, metric)) return;
      if (isSuspiciousUplift(baseline, stats, metric)) return;

      const ci = stats.ci || [];
      if (!lowerBound || ci[0] < lowerBound) lowerBound = ci[0];
      if (!upperBound || ci[1] > upperBound) upperBound = ci[1];
    });
  });
  return [lowerBound, upperBound];
}

const CompactResults: FC<{
  snapshot: ExperimentSnapshotInterface;
  experiment: ExperimentInterfaceStringDates;
  phase?: ExperimentPhaseStringDates;
  isUpdating?: boolean;
}> = ({ snapshot, experiment, phase, isUpdating }) => {
  const { getMetricById } = useDefinitions();

  const results = snapshot.results[0];
  const variations = results?.variations || [];

  const [hasRisk, riskVariation, setRiskVariation] = useRiskVariation(
    experiment,
    variations
  );

  const domain = useDomain(experiment, variations);

  return (
    <div className="mb-4 experiment-compact-holder">
      <DataQualityWarning
        experiment={experiment}
        snapshot={snapshot}
        phase={phase}
        isUpdating={isUpdating}
      />
      <table className={`table experiment-compact aligned-graph`}>
        <thead>
          <tr>
            <th rowSpan={2} className="metric" style={{ minWidth: 125 }}>
              Metric
            </th>
            {hasRisk && (
              <th
                rowSpan={2}
                className="metric"
                style={{ maxWidth: 142, minWidth: 125 }}
              >
                Risk of Choosing&nbsp;
                <Tooltip text="How much you are likely to lose if you choose this variation and it's actually worse">
                  <FaQuestionCircle />
                </Tooltip>
                <div className="mt-1">
                  <select
                    className="form-control form-control-sm"
                    style={{ maxWidth: 150 }}
                    value={riskVariation}
                    onChange={(e) => {
                      setRiskVariation(parseInt(e.target.value));
                    }}
                  >
                    {experiment.variations.map((v, i) => (
                      <option key={v.name} value={i}>
                        {i}: {v.name}
                      </option>
                    ))}
                  </select>
                </div>
              </th>
            )}
            {experiment.variations.map((v, i) => (
              <th colSpan={i ? 3 : 1} className="value" key={i}>
                <span className="text-muted font-weight-normal">{i}:</span>
                &nbsp;{v.name}
              </th>
            ))}
          </tr>
          <tr>
            {experiment.variations.map((v, i) => (
              <React.Fragment key={i}>
                <th className={clsx("value", `variation${i} text-center`)}>
                  Value
                </th>
                {i > 0 && (
                  <th
                    className={`variation${i} text-center`}
                    style={{ minWidth: 110 }}
                  >
                    Chance to Beat Control
                  </th>
                )}
                {i > 0 && (
                  <th className={`variation${i} text-center`}>
                    Percent Change{" "}
                    {hasRisk && (
                      <Tooltip text="The true value is more likely to be in the thicker parts of the graph">
                        <FaQuestionCircle />
                      </Tooltip>
                    )}
                  </th>
                )}
              </React.Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Users</th>
            {hasRisk && <th className="empty-td"></th>}
            {experiment.variations.map((v, i) => (
              <React.Fragment key={i}>
                <td className="value">
                  {numberFormatter.format(variations[i]?.users || 0)}
                </td>
                {i > 0 && (
                  <>
                    <td className="empty-td"></td>
                    <td className="p-0">
                      <div>
                        <AlignedGraph
                          id={experiment.id + "_" + i + "_axis"}
                          domain={domain}
                          significant={true}
                          showAxis={true}
                          axisOnly={true}
                          height={45}
                        />
                      </div>
                    </td>
                  </>
                )}
              </React.Fragment>
            ))}
          </tr>
          {experiment.metrics?.map((m) => {
            const metric = getMetricById(m);
            if (!metric) return null;
            const baseline = variations[0]?.metrics?.[m];

            return (
              <tr
                key={m}
                className={clsx("metricrow", {
                  nodata: !baseline?.value,
                  inverse: metric?.inverse,
                })}
              >
                <th className="metricname">
                  {metric?.name}{" "}
                  {metric?.inverse ? (
                    <Tooltip
                      text="metric is inverse, lower is better"
                      className="inverse-indicator"
                    >
                      <MdSwapCalls />
                    </Tooltip>
                  ) : (
                    ""
                  )}
                </th>
                {hasRisk && (
                  <RiskColumn
                    baselineValue={baseline?.value}
                    metric={metric}
                    riskVariation={riskVariation}
                    variations={variations}
                  />
                )}
                {experiment.variations.map((v, i) => {
                  const stats = { ...variations[i]?.metrics?.[m] };
                  return (
                    <React.Fragment key={i}>
                      <MetricValueColumn
                        metric={metric}
                        stats={stats}
                        users={variations[i].users}
                        className="value variation"
                      />
                      {i > 0 && (
                        <ChanceToWinColumn
                          baseline={baseline}
                          stats={stats}
                          experiment={experiment}
                          metric={metric}
                          phase={snapshot.phase}
                          snapshotDate={snapshot.dateCreated}
                        />
                      )}
                      {i > 0 && (
                        <PercentGraphColumn
                          baseline={baseline}
                          domain={domain}
                          experiment={experiment}
                          metric={metric}
                          stats={stats}
                          variation={i}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
export default CompactResults;
