import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
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
  metric: MetricInterface;
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
