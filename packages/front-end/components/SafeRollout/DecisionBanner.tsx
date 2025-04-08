import { getDecisionFrameworkStatus } from "shared/experiments";
import { useSnapshot } from "./SnapshotProvider";

const DecisionBanner = () => {
  const { safeRollout, latest } = useSnapshot();

  if (!safeRollout) {
    return;
  }

  // Use latest snapshot date and safe rollout start date plus maxDurationDays to determine days left

  const startDate = new Date(safeRollout.startedAt);
  const endDate = new Date(
    startDate.getTime() + safeRollout.maxDurationDays * 24 * 60 * 60 * 1000
  );
  const latestSnapshotDate = latest?.runStarted
    ? new Date(latest?.runStarted)
    : null;
  const daysLeft = latestSnapshotDate
    ? Math.ceil(
        (endDate.getTime() - latestSnapshotDate.getTime()) /
          (1000 * 60 * 60 * 24)
      )
    : safeRollout.maxDurationDays;

  const resultsStatus = safeRollout.analysisSummary?.resultsStatus;
  const decisionStatus = getDecisionFrameworkStatus({
    resultsStatus,
    goalMetrics: [],
    guardrailMetrics: safeRollout.guardrailMetrics,
  });

  if (decisionStatus?.status === "rollback-now") {
    return (
      <div className="alert alert-danger">
        <strong>Decision:</strong> Rollback now
      </div>
    );
  } else if (daysLeft <= 0) {
    return (
      <div className="alert alert-warning">
        <strong>Decision:</strong> Rollback now
      </div>
    );
  } else {
    return (
      <div className="alert alert-success">
        <strong>Decision:</strong> Continue
      </div>
    );
  }
};

export default DecisionBanner;
