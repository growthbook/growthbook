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
  const statusText = () => {
    if (rowResults.resultsStatus === "lost" && rowResults.significant) {
      return "Failing";
    } else if (!rowResults.enoughData) {
      return "Not enough data";
    } else if (!baseline || !stats) {
      return "No data";
    } else {
      return "Within bounds";
    }
  };

  if (hideScaledImpact) {
    return <NoScaledImpact />;
  } else {
    return (
      <div className="d-flex align-items-center h-100">
        <div className="result-number d-inline-block">{statusText()}</div>
      </div>
    );
  }
}
