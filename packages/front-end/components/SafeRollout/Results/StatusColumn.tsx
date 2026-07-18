import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { RowResults } from "@/services/experiments";
import NoScaledImpact from "@/components/Experiment/NoScaledImpact";

interface Props {
  stats: SnapshotMetric;
  baseline: SnapshotMetric;
  rowResults: RowResults;
  className?: string;
  hideScaledImpact?: boolean;
}

export default function StatusColumn({
  stats,
  baseline,
  rowResults,
  hideScaledImpact = false,
}: Props) {
  const isFailing =
    rowResults.resultsStatus === "lost" && rowResults.significant;
  const conclusive = rowResults.enoughData && rowResults.significant;

  const status = (() => {
    if (isFailing) {
      return {
        text: "Failing",
        color: "var(--red-11)",
        emphasizeWhenConclusive: true,
      } as const;
    } else if (!rowResults.enoughData) {
      return {
        text: "Not enough data",
        color: "var(--gray-9)",
        emphasizeWhenConclusive: true,
      } as const;
    } else if (!baseline || !stats) {
      return {
        text: "No data",
        color: "var(--gray-9)",
        emphasizeWhenConclusive: true,
      } as const;
    } else {
      return {
        text: "Within bounds",
        color: "var(--blue-11)",
        emphasizeWhenConclusive: false,
      } as const;
    }
  })();

  if (hideScaledImpact) {
    return <NoScaledImpact />;
  } else {
    return (
      <div className="d-flex align-items-center h-100">
        <span
          style={{
            color: status.color,
            fontWeight:
              conclusive && status.emphasizeWhenConclusive ? 600 : undefined,
          }}
        >
          {status.text}
        </span>
      </div>
    );
  }
}
