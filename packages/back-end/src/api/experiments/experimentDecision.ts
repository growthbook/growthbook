import { ApiExperimentDecision } from "shared/validators";
import { ExperimentResultStatusData } from "shared/types/experiment";

const UNHEALTHY_CHECKS = [
  "srm",
  "multipleExposures",
  "lowPowered",
  "covariateImbalance",
  "clusterAssignment",
  "clusterMapping",
] as const;

function getDecisionCategory(
  status: ExperimentResultStatusData["status"],
): ApiExperimentDecision["category"] {
  switch (status) {
    case "ship-now":
    case "rollback-now":
    case "ready-for-review":
    case "scheduled-end-review":
      return "ready-for-action";
    case "unhealthy":
    case "data-incomplete":
    case "no-data":
      return "has-issue";
    case "days-left":
    case "before-min-duration":
      return "collecting-data";
    default: {
      const unhandled: never = status;
      return unhandled;
    }
  }
}

export function toApiExperimentDecision(
  resultStatus: ExperimentResultStatusData,
  reason: string | undefined,
): ApiExperimentDecision {
  return {
    category: getDecisionCategory(resultStatus.status),
    status: resultStatus.status,
    ...(reason ? { reason } : null),
    ...(resultStatus.status === "days-left"
      ? {
          // Infinite when no treatment variation is getting new units.
          daysLeft: Number.isFinite(resultStatus.daysLeft)
            ? resultStatus.daysLeft
            : null,
        }
      : null),
    ...("variations" in resultStatus
      ? {
          variations: resultStatus.variations.map((v) => ({
            variationId: v.variationId,
            action: v.decidingRule?.action ?? null,
          })),
          powerReached: resultStatus.powerReached,
          sequentialUsed: resultStatus.sequentialUsed,
          scheduledEndPassed: resultStatus.scheduledEndPassed,
        }
      : null),
    ...(resultStatus.status === "unhealthy"
      ? {
          unhealthyChecks: UNHEALTHY_CHECKS.filter(
            (check) => !!resultStatus.unhealthyData[check],
          ),
        }
      : null),
    ...(resultStatus.status === "data-incomplete"
      ? { erroredMetricIds: resultStatus.erroredMetrics }
      : null),
  };
}
