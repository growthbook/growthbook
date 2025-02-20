import type {
  DecisionFrameworkData,
  ExperimentAnalysisSummaryResultsStatus,
} from "back-end/types/experiment";

export function getDaysLeftStatus({
  daysNeeded,
}: {
  daysNeeded: number;
}): DecisionFrameworkData | undefined {
  // TODO: Right now midExperimentPowerEnable is controlling the whole "Days Left" status
  // but we should probably split it when considering Experiment Runtime length without power
  if (daysNeeded > 0) {
    return {
      status: "days-left",
      daysLeft: daysNeeded,
    };
  }
}

export function getDecisionFrameworkStatus({
  resultsStatus,
  goalMetrics,
  guardrailMetrics,
  daysNeeded,
}: {
  resultsStatus: ExperimentAnalysisSummaryResultsStatus;
  goalMetrics: string[];
  guardrailMetrics: string[];
  daysNeeded?: number;
}): DecisionFrameworkData | undefined {
  const powerReached = daysNeeded === 0;

  // Rendering a decision with regular stat sig metrics is only valid
  // if you have reached your needed power or if you used sequential testing
  const decisionReady =
    powerReached || resultsStatus.settings.sequentialTesting;

  let hasWinner = false;
  let hasWinnerWithGuardrailFailure = false;
  let hasSuperStatsigWinner = false;
  let hasSuperStatsigWinnerWithGuardrailFailure = false;
  let nVariationsLosing = 0;
  let nVariationsWithSuperStatSigLoser = 0;
  // if any variation is a clear winner with no guardrail issues, ship now
  for (const variationResult of resultsStatus.variations) {
    const allSuperStatSigWon = goalMetrics.every((m) =>
      variationResult.goalMetrics?.[m]?.status?.includes("superWon")
    );
    const anyGuardrailFailure = guardrailMetrics.some(
      (m) => variationResult.guardrailMetrics?.[m]?.status === "lost"
    );

    if (decisionReady) {
      const allStatSigGood = goalMetrics.every((m) =>
        variationResult.goalMetrics?.[m]?.status.includes("won")
      );
      if (allStatSigGood && !anyGuardrailFailure) {
        hasWinner = true;
      }

      if (allStatSigGood && anyGuardrailFailure) {
        hasWinnerWithGuardrailFailure = true;
      }

      if (
        goalMetrics.every((m) =>
          variationResult.goalMetrics?.[m]?.status?.includes("lost")
        )
      ) {
        nVariationsLosing += 1;
      }
    }

    if (allSuperStatSigWon && !anyGuardrailFailure) {
      hasSuperStatsigWinner = true;
    }

    if (allSuperStatSigWon && anyGuardrailFailure) {
      hasSuperStatsigWinnerWithGuardrailFailure = true;
    }

    if (
      goalMetrics.every((m) =>
        variationResult.goalMetrics?.[m]?.status?.includes("superLost")
      )
    ) {
      nVariationsWithSuperStatSigLoser += 1;
    }
  }

  const tooltipLanguage = powerReached
    ? `Experiment has reached the target statistical power and`
    : resultsStatus.settings.sequentialTesting
    ? `Sequential testing enables calling an experiment as soon as it is significant and`
    : "";

  if (hasWinner) {
    return {
      status: "ship-now",
      tooltip: `${tooltipLanguage} all goal metrics are statistically significant in the desired direction for a test variation.`,
    };
  }

  // if no winner without guardrail failure, call out a winner with a guardrail failure
  if (hasWinnerWithGuardrailFailure) {
    return {
      status: "ready-for-review",
      tooltip: `${tooltipLanguage} all goal metrics are statistically significant in the desired direction for a test variation. However, one or more guardrails are failing`,
    };
  }

  // If all variations failing, roll back now
  if (
    nVariationsLosing === resultsStatus.variations.length &&
    nVariationsLosing > 0
  ) {
    return {
      status: "rollback-now",
      tooltip: `${tooltipLanguage} all goal metrics are statistically significant in the undesired direction.`,
    };
  }

  // TODO if super stat sig enabled
  if (hasSuperStatsigWinner) {
    return {
      status: "ship-now",
      tooltip: `The experiment has not yet reached the target statistical power, however, the goal metrics have clear, statistically significant lifts in the desired direction.`,
    };
  }

  // if no winner without guardrail failure, call out a winner with a guardrail failure
  if (hasSuperStatsigWinnerWithGuardrailFailure) {
    return {
      status: "ready-for-review",
      tooltip: `All goal metrics have clear, statistically significant lifts in the desired direction for a test variation. However, one or more guardrails are failing`,
    };
  }

  if (
    nVariationsWithSuperStatSigLoser === resultsStatus.variations.length &&
    nVariationsWithSuperStatSigLoser > 0
  ) {
    return {
      status: "rollback-now",
      tooltip: `The experiment has not yet reached the target statistical power, however, the goal metrics have clear, statistically significant lifts in the undesired direction.`,
    };
  }

  if (powerReached) {
    return {
      status: "ready-for-review",
      tooltip: `The experiment has reached the target statistical power, but does not have conclusive results.`,
    };
  }
}
