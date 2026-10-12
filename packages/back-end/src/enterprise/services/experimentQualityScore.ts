import { z } from "zod";
import {
  AIExperimentQualityCheckKey,
  ExperimentAIQualityResults,
  ExperimentInterface,
  aiExperimentQualityCheckKeys,
} from "shared/validators";
import {
  computeAIQualityInputsHash,
  customQualityCheckKey,
  getAICheckHashInputs,
  getExperimentDigestForCustomRules,
  isAICheckApplicable,
  resolveExperimentQualityScoreSettings,
  resolveQualityEnabled,
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
  // One entry per user-defined custom rule, matched back by id
  customVerdicts: z
    .array(
      z.object({
        id: z.string(),
        score: z.number().min(0).max(1),
        reason: z.string(),
      }),
    )
    .optional(),
});

const verdictKeyByCheckKey: Record<
  AIExperimentQualityCheckKey,
  "hypothesisQuality" | "hypothesisMetricAlignment" | "learningsQuality"
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

  // Scoring is gated by the org pointer with a per-project tri-state
  // override; the config body lives in its own collection, referenced by
  // id (project pointer wins, else org pointer, else built-in defaults —
  // including when a referenced config has been deleted)
  const orgPointer = context.org.settings?.experimentQuality;
  const project = experiment.project
    ? await context.models.projects.getById(experiment.project)
    : null;
  const projectPointer = project?.settings?.experimentQuality;
  if (!resolveQualityEnabled(orgPointer, projectPointer)) return null;

  const configId = projectPointer?.configId ?? orgPointer?.configId;
  const configDoc = configId
    ? await context.models.experimentQualityConfigs.getById(configId)
    : null;
  const settings = resolveExperimentQualityScoreSettings(configDoc);
  if (!settings.aiChecksEnabled) return null;

  const { aiEnabled } = await getAISettingsForOrg(context);
  if (!aiEnabled) return null;

  const applicableChecks = aiExperimentQualityCheckKeys.filter(
    (key) =>
      settings.checks[key].enabled && isAICheckApplicable(key, experiment),
  );
  const applicableCustomChecks = settings.customAiChecks.filter(
    (c) => c.enabled,
  );
  if (!applicableChecks.length && !applicableCustomChecks.length) return null;

  const goalMetrics = await getExperimentMetricsByIds(
    context,
    experiment.goalMetrics,
  );
  const goalMetricNames = goalMetrics.map((m) => m.name);

  // Custom rules read a trimmed projection of the whole experiment, so it
  // joins both the prompt and the invalidation hash
  const experimentDigest = applicableCustomChecks.length
    ? getExperimentDigestForCustomRules(experiment, goalMetricNames)
    : "";

  const inputsHash = computeAIQualityInputsHash({
    hypothesis: experiment.hypothesis,
    analysis: experiment.analysis,
    goalMetricNames,
    aiCheckContexts: getAICheckHashInputs(settings),
    experimentDigest,
  });
  if (!force && experiment.aiQualityResults?.inputsHash === inputsHash) {
    return null;
  }

  // Skip while over the AI usage limit; the sweep job will retry later
  if ((await secondsUntilAICanBeUsedAgain(context.org)) > 0) return null;

  const { prompt, isDefaultPrompt, overrideModel } =
    await context.models.aiPrompts.getAIPrompt("experiment-quality");

  // Judge hypothesis quality against the same (possibly org-customized)
  // definition of a good hypothesis used on the AI settings page. Like
  // custom prompt text, this is applied to new verdicts only — the
  // "Recalculate AI verdicts" action re-scores existing experiments.
  const hypothesisDefinition = applicableChecks.includes(
    "ai-hypothesis-quality",
  )
    ? (await context.models.aiPrompts.getAIPrompt("experiment-hypothesis"))
        .prompt
    : "";

  const customRulesPrompt = applicableCustomChecks.length
    ? [
        `Experiment data (JSON):\n${experimentDigest}`,
        `Additionally, evaluate these custom rules against the experiment data. Return one entry per rule in customVerdicts with the rule's id, a score from 0 to 1, and a one-sentence reason. For point-based rules, return the fraction of the maximum points.\n${applicableCustomChecks
          .map((c) => `- id: ${c.id} · name: ${c.name} · rule: ${c.rule}`)
          .join("\n")}`,
      ]
    : [];

  const userPrompt = [
    `Experiment name: ${experiment.name}`,
    experiment.hypothesis ? `Hypothesis: ${experiment.hypothesis}` : "",
    goalMetricNames.length ? `Goal metrics: ${goalMetricNames.join(", ")}` : "",
    applicableChecks.includes("ai-learnings-quality") && experiment.analysis
      ? `Results summary / learnings: ${experiment.analysis}`
      : "",
    applicableChecks.length
      ? `Score ONLY these dimensions:\n${applicableChecks
          .map((key) => {
            const checkContext = settings.checks[key].aiContext?.trim();
            if (key === "ai-hypothesis-quality") {
              // The check's own context (seeded from, and editable next to,
              // the AI settings hypothesis definition) replaces the definition
              // when set — never both
              const definition = checkContext || hypothesisDefinition.trim();
              return (
                `- ${dimensionInstructionByCheckKey[key]}` +
                (definition
                  ? `\n  Judge the hypothesis against this definition of a good hypothesis: ${definition}`
                  : "")
              );
            }
            return (
              `- ${dimensionInstructionByCheckKey[key]}` +
              (checkContext
                ? `\n  Additional context for this dimension: ${checkContext}`
                : "")
            );
          })
          .join("\n")}`
      : "Do not score the built-in dimensions (hypothesisQuality, hypothesisMetricAlignment, learningsQuality) — omit them from your response.",
    ...customRulesPrompt,
  ]
    .filter(Boolean)
    .join("\n\n");

  let aiQualityResults: ExperimentAIQualityResults;
  try {
    const verdicts = await parsePrompt({
      context,
      instructions: prompt,
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
      checks: [
        ...applicableChecks.flatMap((key) => {
          const verdict = verdicts[verdictKeyByCheckKey[key]];
          return verdict
            ? [{ key, score: verdict.score, reason: verdict.reason }]
            : [];
        }),
        ...applicableCustomChecks.flatMap((custom) => {
          const verdict = verdicts.customVerdicts?.find(
            (v) => v.id === custom.id,
          );
          return verdict
            ? [
                {
                  key: customQualityCheckKey(custom.id),
                  score: verdict.score,
                  reason: verdict.reason,
                },
              ]
            : [];
        }),
      ],
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
