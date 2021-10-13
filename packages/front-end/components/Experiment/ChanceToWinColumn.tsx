import clsx from "clsx";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import useConfidenceLevels from "../../hooks/useConfidenceLevels";
import {
  hasEnoughData,
  isBelowMinChange,
  isSuspiciousUplift,
} from "../../services/experiments";
import { defaultMinSampleSize } from "../../services/metrics";
import NotEnoughData from "./NotEnoughData";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function ChanceToWinColumn({
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
