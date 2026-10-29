import { z } from "zod";
import { isEqual, pick } from "lodash";
import {
  AIExperimentQualityCheckKey,
  ExperimentAIQualityResults,
  ExperimentInterface,
  ExperimentationHealthSettingsInterface,
  aiExperimentQualityCheckKeys,
  ORG_DEFAULT_SCOPE,
} from "shared/validators";
import {
  EXPERIMENT_QUALITY_PROMPT_VERSION,
  EXPERIMENT_QUALITY_SCORE_VERSION,
  customQualityCheckKey,
  getAIQualityInputsHash,
  getExperimentDigestForCustomRules,
  getExperimentQualityScore,
  getGoalMetricNames,
  isAICheckApplicable,
  resolveExperimentQualitySettings,
} from "shared/enterprise";
import { expandMetricGroups } from "shared/experiments";
import { ReqContext } from "back-end/types/request";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import {
  parsePrompt,
  secondsUntilAICanBeUsedAgain,
} from "back-end/src/enterprise/services/ai";
import { getExperimentMetricsByIds } from "back-end/src/services/experiments";
import {
  getExperimentById,
  setExperimentQualityCache,
} from "back-end/src/models/ExperimentModel";
import {
  isDecisionModelConfigured,
  judgeQualityWithDecisionModel,
} from "back-end/src/enterprise/services/decisionModel";
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
export async function loadAIQualityInputs(
  context: ReqContext,
  goalMetricIds: string[],
) {
  const [records, metricGroups] = await Promise.all([
    context.models.experimentationHealthSettings.getAll(),
    context.models.metricGroups.getAll(),
  ]);
  // Goal metrics can be metric groups; the AI judges their members
  const metrics = await getExperimentMetricsByIds(context, [
    ...new Set(expandMetricGroups(goalMetricIds, metricGroups)),
  ]);
  const recordsByProject = new Map(records.map((r) => [r.project, r]));
  const metricNames = new Map(metrics.map((m) => [m.id, m.name]));
  return { recordsByProject, metricGroups, metricNames };
}

export type AIQualityInputs = Awaited<ReturnType<typeof loadAIQualityInputs>>;

// The AI checks an experiment needs and their current inputs hash, or null
// when scoring is off for it or none of its AI checks apply
function getAIQualityWork(
  experiment: ExperimentInterface,
  inputs: AIQualityInputs,
) {
  const settings = resolveExperimentQualitySettings({
    orgRecord: inputs.recordsByProject.get(ORG_DEFAULT_SCOPE),
    projectRecord: experiment.project
      ? inputs.recordsByProject.get(experiment.project)
      : null,
    aiEnabled: true,
  });
  if (!settings?.aiChecksEnabled) return null;

  const applicableChecks = aiExperimentQualityCheckKeys.filter(
    (key) =>
      settings.checks[key].enabled && isAICheckApplicable(key, experiment),
  );
  const applicableCustomChecks = settings.customAiChecks.filter(
    (c) => c.enabled,
  );
  if (!applicableChecks.length && !applicableCustomChecks.length) return null;

  const goalMetricNames = getGoalMetricNames(
    expandMetricGroups(experiment.goalMetrics, inputs.metricGroups),
    (id) => inputs.metricNames.get(id),
  );
  return {
    settings,
    applicableChecks,
    applicableCustomChecks,
    goalMetricNames,
    inputsHash: getAIQualityInputsHash(experiment, settings),
  };
}

// Which Projects have quality scoring on, as an experiment query: null when
// it's on nowhere. Experiments without a Project follow the organization.
export function getQualityScopeFilter(
  records: ExperimentationHealthSettingsInterface[],
): { project?: { $in: string[] } | { $nin: string[] } } | null {
  const orgOn =
    records.find((r) => r.project === ORG_DEFAULT_SCOPE)?.quality?.enabled ??
    false;
  const projects = (enabled: boolean) =>
    records
      .filter(
        (r) =>
          r.project !== ORG_DEFAULT_SCOPE && r.quality?.enabled === enabled,
      )
      .map((r) => r.project);
  if (orgOn) {
    const off = projects(false);
    return off.length ? { project: { $nin: off } } : {};
  }
  const on = projects(true);
  return on.length ? { project: { $in: on } } : null;
}

type AIQualityCheckResult = ExperimentAIQualityResults["checks"][number];
type ResolvedSettings = NonNullable<
  ReturnType<typeof resolveExperimentQualitySettings>
>;

async function judgeWithDecisionModel({
  experiment,
  settings,
  checks,
  customChecks,
  goalMetricNames,
  hypothesisPrompt,
}: {
  experiment: ExperimentInterface;
  settings: ResolvedSettings;
  checks: AIExperimentQualityCheckKey[];
  customChecks: ResolvedSettings["customAiChecks"];
  goalMetricNames: string[];
  hypothesisPrompt: { prompt: string; isDefaultPrompt: boolean } | null;
}): Promise<AIQualityCheckResult[]> {
  // The org's own guidance; the default definition is covered by the
  // built-in questions
  const customDefinition =
    hypothesisPrompt && !hypothesisPrompt.isDefaultPrompt
      ? hypothesisPrompt.prompt.trim()
      : "";
  const { verdicts } = await judgeQualityWithDecisionModel({
    hypothesis: experiment.hypothesis ?? "",
    goalMetricNames,
    hypothesisGuidance:
      settings.checks["ai-hypothesis-quality"].aiContext?.trim() ||
      customDefinition ||
      undefined,
    alignmentGuidance:
      settings.checks["ai-hypothesis-metric-alignment"].aiContext?.trim() ||
      undefined,
    builtInChecks: checks.length > 0,
    customChecks: customChecks.map(({ key, rule }) => ({ key, rule })),
    experimentDigest: customChecks.length
      ? getExperimentDigestForCustomRules(experiment, goalMetricNames)
      : "",
  });
  return [...checks, ...customChecks.map((c) => c.key)].flatMap((key) => {
    const verdict = verdicts[key];
    return verdict ? [{ key, ...verdict }] : [];
  });
}

async function judgeWithChatModel({
  context,
  experiment,
  settings,
  checks,
  customChecks,
  goalMetricNames,
  hypothesisDefinition,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  settings: ResolvedSettings;
  checks: AIExperimentQualityCheckKey[];
  customChecks: ResolvedSettings["customAiChecks"];
  goalMetricNames: string[];
  hypothesisDefinition: string;
}): Promise<AIQualityCheckResult[]> {
  // Custom rules read a trimmed projection of the whole experiment
  const experimentDigest = customChecks.length
    ? getExperimentDigestForCustomRules(experiment, goalMetricNames)
    : "";

  const customRulesPrompt = customChecks.length
    ? [
        `Experiment data (JSON):\n${experimentDigest}`,
        `Additionally, evaluate these custom rules against the experiment data. Return one entry per rule in customVerdicts with the rule's id, a score from 0 to 1, and a one-sentence reason. For point-based rules, return the fraction of the maximum points.\n${customChecks
          .map((c) => `- id: ${c.id} · name: ${c.name} · rule: ${c.rule}`)
          .join("\n")}`,
      ]
    : [];

  const userPrompt = [
    `Experiment name: ${experiment.name}`,
    experiment.hypothesis ? `Hypothesis: ${experiment.hypothesis}` : "",
    goalMetricNames.length ? `Goal metrics: ${goalMetricNames.join(", ")}` : "",
    checks.length
      ? `Score ONLY these dimensions:\n${checks
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

  const { prompt, isDefaultPrompt, overrideModel } =
    await context.models.aiPrompts.getAIPrompt("experiment-quality");
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
  return [
    ...checks.flatMap((key) => {
      const verdict = verdicts[verdictKeyByCheckKey[key]];
      return verdict
        ? [{ key, score: verdict.score, reason: verdict.reason }]
        : [];
    }),
    ...customChecks.flatMap((custom) => {
      const verdict = verdicts.customVerdicts?.find((v) => v.id === custom.id);
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
  ];
}

export type AIQualityOutcome =
  // Nothing to do: scoring or AI is off, no checks apply, or it's fresh
  | { status: "skipped" }
  | { status: "updated"; experiment: ExperimentInterface }
  | { status: "rate-limited"; retryInSeconds: number }
  // The error is also stored on the experiment
  | { status: "failed"; experiment: ExperimentInterface };

/**
 * Runs the AI quality checks for an experiment and caches the verdicts on
 * the experiment document (`aiQualityResults`), keyed by an inputs hash so
 * unchanged experiments never trigger another AI call.
 */
export async function computeAndStoreAIQualityChecks({
  context,
  experiment,
  force = false,
  inputs,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  force?: boolean;
  // Loaded once by callers that score many experiments
  inputs?: AIQualityInputs;
}): Promise<AIQualityOutcome> {
  if (
    !context.hasPremiumFeature("experiment-quality-score") ||
    !context.org.settings?.aiEnabled ||
    !(await getAISettingsForOrg(context)).aiEnabled
  ) {
    return { status: "skipped" };
  }

  const work = getAIQualityWork(
    experiment,
    inputs ?? (await loadAIQualityInputs(context, experiment.goalMetrics)),
  );
  if (!work) return { status: "skipped" };
  const {
    settings,
    applicableChecks,
    applicableCustomChecks,
    goalMetricNames,
    inputsHash,
  } = work;
  if (!force && experiment.aiQualityResults?.inputsHash === inputsHash) {
    return { status: "skipped" };
  }

  // With a decision model configured, it judges the built-in checks and the
  // custom rules routed to it; the chat model judges the rest
  const hasDecisionModel = isDecisionModelConfigured();
  const decisionChecks = hasDecisionModel ? applicableChecks : [];
  const chatChecks = hasDecisionModel ? [] : applicableChecks;
  const decisionCustomChecks = hasDecisionModel
    ? applicableCustomChecks.filter((c) => c.judge === "decision")
    : [];
  const chatCustomChecks = applicableCustomChecks.filter(
    (c) => !decisionCustomChecks.includes(c),
  );
  const useDecisionModel =
    !!decisionChecks.length || !!decisionCustomChecks.length;
  const useChatModel = !!chatChecks.length || !!chatCustomChecks.length;

  // Wait out the AI usage limit; the caller retries later
  if (useChatModel) {
    const retryInSeconds = await secondsUntilAICanBeUsedAgain(context.org);
    if (retryInSeconds > 0) return { status: "rate-limited", retryInSeconds };
  }

  // Hypothesis quality is judged against the same (possibly customized)
  // definition of a good hypothesis used on the AI settings page
  const hypothesisPrompt = applicableChecks.includes("ai-hypothesis-quality")
    ? await context.models.aiPrompts.getAIPrompt("experiment-hypothesis")
    : null;

  let aiQualityResults: ExperimentAIQualityResults;
  try {
    const checks = await Promise.all([
      useDecisionModel
        ? judgeWithDecisionModel({
            experiment,
            settings,
            checks: decisionChecks,
            customChecks: decisionCustomChecks,
            goalMetricNames,
            hypothesisPrompt,
          })
        : [],
      useChatModel
        ? judgeWithChatModel({
            context,
            experiment,
            settings,
            checks: chatChecks,
            customChecks: chatCustomChecks,
            goalMetricNames,
            hypothesisDefinition: hypothesisPrompt?.prompt ?? "",
          })
        : [],
    ]);
    // A missing answer is a failure, so it's retried rather than cached
    const answered = new Set(checks.flat().map((c) => c.key));
    const missing = [
      ...applicableChecks,
      ...applicableCustomChecks.map((c) => c.key),
    ].filter((key) => !answered.has(key));
    if (missing.length) {
      throw new Error(`The AI didn't score ${missing.join(", ")}`);
    }
    aiQualityResults = {
      inputsHash,
      version: EXPERIMENT_QUALITY_PROMPT_VERSION,
      dateComputed: new Date(),
      checks: checks.flat(),
    };
  } catch (e) {
    logger.error(
      e,
      `Failed to compute AI quality checks for experiment ${experiment.id}`,
    );
    // Shown on the experiment until a retry succeeds
    aiQualityResults = {
      inputsHash,
      version: EXPERIMENT_QUALITY_PROMPT_VERSION,
      dateComputed: new Date(),
      checks: [],
      error: e instanceof Error ? e.message : "AI scoring failed",
    };
  }

  // Inputs that changed during the call have already queued a fresh run,
  // which must not be overwritten by these older answers
  const latest = await getExperimentById(context, experiment.id);
  const latestWork =
    latest &&
    getAIQualityWork(
      latest,
      await loadAIQualityInputs(context, latest.goalMetrics),
    );
  if (!latest || latestWork?.inputsHash !== inputsHash) {
    return { status: "skipped" };
  }

  await setExperimentQualityCache(context, latest.id, { aiQualityResults });
  return {
    status: aiQualityResults.error ? "failed" : "updated",
    experiment: { ...latest, aiQualityResults },
  };
}

// What the stored quality score reads besides the experiment, loaded once
// for any number of the org's experiments
export async function loadQualityScoreInputs(context: ReqContext) {
  const [records, aiSettings] = await Promise.all([
    context.models.experimentationHealthSettings.getAll(),
    getAISettingsForOrg(context),
  ]);
  return {
    recordsByProject: new Map(records.map((r) => [r.project, r])),
    aiEnabled: aiSettings.aiEnabled,
  };
}

// Recomputes the experiment's stored quality score, writing only when it
// changed; null when scoring is off for the experiment's scope
export async function storeQualityScore(
  context: ReqContext,
  experiment: ExperimentInterface,
  attempt = 0,
): Promise<void> {
  // Read just before saving, so settings changed during an AI call count
  const inputs = await loadQualityScoreInputs(context);
  const settings = context.hasPremiumFeature("experiment-quality-score")
    ? resolveExperimentQualitySettings({
        orgRecord: inputs.recordsByProject.get(ORG_DEFAULT_SCOPE),
        projectRecord: experiment.project
          ? inputs.recordsByProject.get(experiment.project)
          : null,
        aiEnabled: inputs.aiEnabled,
      })
    : null;
  const result = settings
    ? getExperimentQualityScore({ experiment, settings })
    : null;
  const next = result
    ? {
        ...pick(result, ["score", "computedScore", "pending"]),
        version: EXPERIMENT_QUALITY_SCORE_VERSION,
      }
    : null;
  const current = experiment.qualityScore
    ? pick(experiment.qualityScore, [
        "score",
        "computedScore",
        "pending",
        "version",
      ])
    : null;
  if (isEqual(next, current)) return;

  // Only lands if what it read is still current; otherwise starts over
  // from the latest experiment
  const stored = await setExperimentQualityCache(
    context,
    experiment.id,
    { qualityScore: next && { ...next, dateComputed: new Date() } },
    {
      dateUpdated: experiment.dateUpdated ?? null,
      "aiQualityResults.dateComputed":
        experiment.aiQualityResults?.dateComputed ?? null,
      "processResults.dateComputed":
        experiment.processResults?.dateComputed ?? null,
      // A score saved since this run read the experiment is newer
      "qualityScore.dateComputed":
        experiment.qualityScore?.dateComputed ?? null,
    },
  );
  if (!stored && attempt < 2) {
    const latest = await getExperimentById(context, experiment.id);
    if (latest) await storeQualityScore(context, latest, attempt + 1);
  }
}
