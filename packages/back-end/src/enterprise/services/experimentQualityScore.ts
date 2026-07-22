import { z } from "zod";
import {
  AIExperimentQualityCheckKey,
  ExperimentAIQualityResults,
  ExperimentInterface,
  aiExperimentQualityCheckKeys,
} from "shared/validators";
import {
  computeAIQualityInputsHash,
  isAICheckApplicable,
  resolveExperimentQualityScoreSettings,
} from "shared/enterprise";
import { ReqContext } from "back-end/types/request";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import {
  parsePrompt,
  secondsUntilAICanBeUsedAgain,
} from "back-end/src/enterprise/services/ai";
import { getExperimentMetricsByIds } from "back-end/src/services/experiments";
import { updateExperiment } from "back-end/src/models/ExperimentModel";
import { logger } from "back-end/src/util/logger";

const aiQualityVerdict = z.object({
  score: z.number().min(0).max(1),
  reason: z.string(),
});

const aiQualityVerdictSchema = z.object({
  hypothesisQuality: aiQualityVerdict.optional(),
  hypothesisMetricAlignment: aiQualityVerdict.optional(),
  learningsQuality: aiQualityVerdict.optional(),
});

const verdictKeyByCheckKey: Record<
  AIExperimentQualityCheckKey,
  keyof z.infer<typeof aiQualityVerdictSchema>
> = {
  "ai-hypothesis-quality": "hypothesisQuality",
  "ai-hypothesis-metric-alignment": "hypothesisMetricAlignment",
  "ai-learnings-quality": "learningsQuality",
};

const dimensionInstructionByCheckKey: Record<
  AIExperimentQualityCheckKey,
  string
> = {
  "ai-hypothesis-quality": "hypothesisQuality: score the hypothesis quality",
  "ai-hypothesis-metric-alignment":
    "hypothesisMetricAlignment: score how well the goal metrics measure what the hypothesis predicts",
  "ai-learnings-quality":
    "learningsQuality: score the quality of the documented results summary / learnings",
};

/**
 * Runs the AI quality checks for an experiment and caches the verdicts on
 * the experiment document (`aiQualityResults`), keyed by an inputs hash so
 * unchanged experiments never trigger another AI call.
 *
 * Returns the updated experiment, or null when nothing was computed
 * (feature/AI disabled, no applicable checks, fresh cache, or rate limited).
 */
export async function computeAndStoreAIQualityChecks({
  context,
  experiment,
  force = false,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  force?: boolean;
}): Promise<ExperimentInterface | null> {
  if (!context.hasPremiumFeature("experiment-quality-score")) return null;

  const settings = resolveExperimentQualityScoreSettings(
    context.org.settings?.experimentQualityScoreSettings,
  );
  if (!settings.enabled || !settings.aiChecksEnabled) return null;

  const { aiEnabled } = getAISettingsForOrg(context);
  if (!aiEnabled) return null;

  const applicableChecks = aiExperimentQualityCheckKeys.filter(
    (key) =>
      settings.checks[key].enabled && isAICheckApplicable(key, experiment),
  );
  if (!applicableChecks.length) return null;

  const goalMetrics = await getExperimentMetricsByIds(
    context,
    experiment.goalMetrics,
  );
  const goalMetricNames = goalMetrics.map((m) => m.name);

  const inputsHash = computeAIQualityInputsHash({
    hypothesis: experiment.hypothesis,
    analysis: experiment.analysis,
    goalMetricNames,
    aiContext: settings.aiContext,
  });
  if (!force && experiment.aiQualityResults?.inputsHash === inputsHash) {
    return null;
  }

  // Skip while over the AI usage limit; the sweep job will retry later
  if ((await secondsUntilAICanBeUsedAgain(context.org)) > 0) return null;

  const { prompt, isDefaultPrompt, overrideModel } =
    await context.models.aiPrompts.getAIPrompt("experiment-quality");

  const instructions = [
    prompt,
    settings.aiContext
      ? `Additional context from the organization:\n${settings.aiContext}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const userPrompt = [
    `Experiment name: ${experiment.name}`,
    experiment.hypothesis ? `Hypothesis: ${experiment.hypothesis}` : "",
    goalMetricNames.length ? `Goal metrics: ${goalMetricNames.join(", ")}` : "",
    applicableChecks.includes("ai-learnings-quality") && experiment.analysis
      ? `Results summary / learnings: ${experiment.analysis}`
      : "",
    `Score ONLY these dimensions:\n${applicableChecks
      .map((key) => `- ${dimensionInstructionByCheckKey[key]}`)
      .join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  let aiQualityResults: ExperimentAIQualityResults;
  try {
    const verdicts = await parsePrompt({
      context,
      instructions,
      prompt: userPrompt,
      temperature: 0.1,
      type: "experiment-quality",
      isDefaultPrompt,
      zodObjectSchema: aiQualityVerdictSchema,
      overrideModel,
    });
    aiQualityResults = {
      inputsHash,
      dateComputed: new Date(),
      checks: applicableChecks.flatMap((key) => {
        const verdict = verdicts[verdictKeyByCheckKey[key]];
        return verdict
          ? [{ key, score: verdict.score, reason: verdict.reason }]
          : [];
      }),
    };
  } catch (e) {
    logger.error(
      e,
      `Failed to compute AI quality checks for experiment ${experiment.id}`,
    );
    // Store the hash with an error sentinel so the sweep doesn't retry
    // until the inputs change (or a manual refresh forces it)
    aiQualityResults = {
      inputsHash,
      dateComputed: new Date(),
      checks: [],
      error: e instanceof Error ? e.message : "AI scoring failed",
    };
  }

  return updateExperiment({
    context,
    experiment,
    changes: { aiQualityResults },
    bypassWebhooks: true,
  });
}
