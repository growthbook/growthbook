import { ApiExperimentDecision } from "shared/validators";
import {
  ExperimentResultStatusData,
  ExperimentUnhealthyData,
} from "shared/types/experiment";

type HealthIssue = NonNullable<ApiExperimentDecision["healthIssues"]>[number];

// Keyed by the app's checks, so a new check needs a public name to compile.
const HEALTH_ISSUES: Record<keyof ExperimentUnhealthyData, HealthIssue> = {
  srm: "sample-ratio-mismatch",
  multipleExposures: "multiple-exposures",
  lowPowered: "low-power",
  covariateImbalance: "covariate-imbalance",
  clusterAssignment: "mixed-cluster-assignment",
  clusterMapping: "units-in-multiple-clusters",
};
const HEALTH_CHECKS = Object.keys(
  HEALTH_ISSUES,
) as (keyof ExperimentUnhealthyData)[];

export function toApiExperimentDecision(
  resultStatus: ExperimentResultStatusData,
  category: ApiExperimentDecision["category"],
  reason: string | undefined,
): ApiExperimentDecision {
  return {
    category,
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
        }
      : null),
    ...(resultStatus.status === "unhealthy"
      ? {
          healthIssues: HEALTH_CHECKS.filter(
            (check) => !!resultStatus.unhealthyData[check],
          ).map((check) => HEALTH_ISSUES[check]),
        }
      : null),
    ...(resultStatus.status === "data-incomplete"
      ? { erroredMetricIds: resultStatus.erroredMetrics }
      : null),
  };
}
