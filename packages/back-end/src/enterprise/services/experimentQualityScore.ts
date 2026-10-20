import { z } from "zod";
import {
  AIExperimentQualityCheckKey,
  ExperimentAIQualityResults,
  ExperimentInterface,
  aiExperimentQualityCheckKeys,
  ORG_DEFAULT_SCOPE,
} from "shared/validators";
import {
  customQualityCheckKey,
  getAIQualityInputsHash,
  getExperimentDigestForCustomRules,
  getGoalMetricNames,
  isAICheckApplicable,
  resolveExperimentQualitySettings,
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
  "hypothesisQuality" | "hypothesisMetricAlignment"
> = {
  "ai-hypothesis-quality": "hypothesisQuality",
  "ai-hypothesis-metric-alignment": "hypothesisMetricAlignment",
};

const dimensionInstructionByCheckKey: Record<
  AIExperimentQualityCheckKey,
  string
> = {
  "ai-hypothesis-quality": "hypothesisQuality: score the hypothesis quality",
  "ai-hypothesis-metric-alignment":
    "hypothesisMetricAlignment: score how well the goal metrics measure what the hypothesis predicts",
};

// The org-wide inputs for AI quality scoring, loaded once for any number
// of the org's experiments
async function loadAIQualityInputs(
  context: ReqContext,
  goalMetricIds: string[],
) {
  const [records, configs, metrics] = await Promise.all([
    context.models.experimentationHealthSettings.getAll(),
    context.models.experimentQualityConfigs.getAll(),
    getExperimentMetricsByIds(context, [...new Set(goalMetricIds)]),
  ]);
  const recordsByProject = new Map(records.map((r) => [r.project, r]));
  const configsById = new Map(configs.map((c) => [c.id, c]));
  const metricNames = new Map(metrics.map((m) => [m.id, m.name]));
  return { recordsByProject, configsById, metricNames };
}

// The AI checks an experiment needs and their current inputs hash, or null
// when scoring is off for it or none of its AI checks apply
function getAIQualityWork(
  experiment: ExperimentInterface,
  inputs: Awaited<ReturnType<typeof loadAIQualityInputs>>,
) {
  const resolved = resolveExperimentQualitySettings({
    orgRecord: inputs.recordsByProject.get(ORG_DEFAULT_SCOPE),
    projectRecord: experiment.project
      ? inputs.recordsByProject.get(experiment.project)
      : null,
    getConfig: (id) => inputs.configsById.get(id),
    aiEnabled: true,
  });
  if (!resolved?.settings.aiChecksEnabled) return null;
  const { settings } = resolved;

  const applicableChecks = aiExperimentQualityCheckKeys.filter(
    (key) =>
      settings.checks[key].enabled && isAICheckApplicable(key, experiment),
  );
  const applicableCustomChecks = settings.customAiChecks.filter(
    (c) => c.enabled,
  );
  if (!applicableChecks.length && !applicableCustomChecks.length) return null;

  const goalMetricNames = getGoalMetricNames(experiment.goalMetrics, (id) =>
    inputs.metricNames.get(id),
  );
  return {
    settings,
    applicableChecks,
    applicableCustomChecks,
    goalMetricNames,
    inputsHash: getAIQualityInputsHash(experiment, settings, goalMetricNames),
  };
}

// Experiments whose cached AI verdicts are missing or out of date
export async function getStaleAIQualityExperimentIds(
  context: ReqContext,
  experiments: ExperimentInterface[],
): Promise<string[]> {
  const inputs = await loadAIQualityInputs(
    context,
    experiments.flatMap((e) => e.goalMetrics),
  );
  return experiments
    .filter((experiment) => {
      const work = getAIQualityWork(experiment, inputs);
      return (
        !!work && experiment.aiQualityResults?.inputsHash !== work.inputsHash
      );
    })
    .map((experiment) => experiment.id);
}

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
  if (
    !context.hasPremiumFeature("experiment-quality-score") ||
    !context.org.settings?.aiEnabled
  ) {
    return null;
  }

  const [inputs, { aiEnabled }] = await Promise.all([
    loadAIQualityInputs(context, experiment.goalMetrics),
    getAISettingsForOrg(context),
  ]);
  if (!aiEnabled) return null;

  const work = getAIQualityWork(experiment, inputs);
  if (!work) return null;
  const {
    settings,
    applicableChecks,
    applicableCustomChecks,
    goalMetricNames,
    inputsHash,
  } = work;
  if (!force && experiment.aiQualityResults?.inputsHash === inputsHash) {
    return null;
  }

  // Custom rules read a trimmed projection of the whole experiment
  const experimentDigest = applicableCustomChecks.length
    ? getExperimentDigestForCustomRules(experiment, goalMetricNames)
    : "";

  // Skip while over the AI usage limit; the sweep job will retry later
  if ((await secondsUntilAICanBeUsedAgain(context.org)) > 0) return null;

  // Hypothesis quality is judged against the same (possibly customized)
  // definition of a good hypothesis used on the AI settings page
  const [{ prompt, isDefaultPrompt, overrideModel }, hypothesisPrompt] =
    await Promise.all([
      context.models.aiPrompts.getAIPrompt("experiment-quality"),
      applicableChecks.includes("ai-hypothesis-quality")
        ? context.models.aiPrompts.getAIPrompt("experiment-hypothesis")
        : null,
    ]);
  const hypothesisDefinition = hypothesisPrompt?.prompt ?? "";

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
      : "Do not score the built-in dimensions (hypothesisQuality, hypothesisMetricAlignment) — omit them from your response.",
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
