import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { ExperimentMetricInterface } from "shared/experiments";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import { hasEnoughData } from "@/services/experiments";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import AlignedGraph from "./AlignedGraph";

export default function PercentGraphColumn({
  metric,
  baseline,
  stats,
  domain,
  id,
  barType: _barType,
}: {
  metric: ExperimentMetricInterface;
  baseline: SnapshotMetric;
  stats: SnapshotMetric;
  domain: [number, number];
  id: string;
  barType?: "pill" | "violin";
}) {
  const { metricDefaults } = useOrganizationMetricDefaults();
  const enoughData = hasEnoughData(baseline, stats, metric, metricDefaults);
  const { ciUpper, ciLower } = useConfidenceLevels();
  const barType = _barType ? _barType : stats.uplift?.dist ? "violin" : "pill";

  const showGraph = metric && enoughData;
  return (
    <td className="compact-graph pb-0 align-middle">
      <AlignedGraph
        ci={showGraph ? stats.ci || [] : [0, 0]}
        id={id}
        domain={domain}
        uplift={showGraph ? stats.uplift : undefined}
        expected={showGraph ? stats.expected : undefined}
        barType={barType}
        barFillType="gradient"
        axisOnly={!showGraph}
        showAxis={false}
        significant={
          showGraph
            ? (stats.chanceToWin ?? 0) > ciUpper ||
              (stats.chanceToWin ?? 0) < ciLower
            : false
        }
        height={75}
        inverse={!!metric?.inverse}
      />
    </td>
  );
}
