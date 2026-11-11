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

export function toApiExperimentDecision(
  resultStatus: ExperimentResultStatusData,
  reason: string | undefined,
): ApiExperimentDecision {
  return {
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
