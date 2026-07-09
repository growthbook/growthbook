import { createHash } from "crypto";
import type { Response } from "express";
import {
  InsightInterface,
  aiInsightSuggestionsResponseValidator,
  AiInsightSuggestion,
} from "shared/validators";
import { ExperimentInterface } from "shared/types/experiment";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { ExperimentMetricInterface } from "shared/experiments";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ReqContext } from "back-end/types/request";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getInsightTextForEmbedding } from "back-end/src/models/InsightModel";
import {
  cosineSimilarity,
  generateEmbeddings,
  parsePrompt,
} from "back-end/src/enterprise/services/ai";
import { runAccessGates } from "back-end/src/enterprise/services/ai-access";
import { getExperimentsByIds } from "back-end/src/models/ExperimentModel";
import { getLatestSnapshotMultipleExperiments } from "back-end/src/models/ExperimentSnapshotModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { getAllTags } from "back-end/src/models/TagModel";
import { logger } from "back-end/src/util/logger";

type InsightWithCanManage = InsightInterface & { canManage: boolean };

type ListInsightsResponse = {
  status: 200;
  insights: InsightWithCanManage[];
};

export const getInsights = async (
  req: AuthRequest<unknown, unknown, { project?: string }>,
  res: Response<ListInsightsResponse>,
) => {
  const context = getContextFromReq(req);
  const project =
    typeof req.query?.project === "string" ? req.query.project : "";

  const allInsights = await context.models.insights.getAll();

  // Scope to the current project. Insights with no projects live in
  // "All projects" and are always included (same convention as metrics,
  // segments, and other multi-project resources).
  const insights = project
    ? allInsights.filter(
        (i) => !i.projects?.length || i.projects.includes(project),
      )
    : allInsights;

  res.status(200).json({
    status: 200,
    insights: insights.map((i) => ({
      ...i,
      canManage: context.models.insights.canManageInsight(i),
    })),
  });
};

export const getInsight = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200; insight: InsightWithCanManage }>,
) => {
  const context = getContextFromReq(req);
  const insight = await context.models.insights.getById(req.params.id);
  if (!insight) {
    throw new Error("Insight not found");
  }
  res.status(200).json({
    status: 200,
    insight: {
      ...insight,
      canManage: context.models.insights.canManageInsight(insight),
    },
  });
};

type CreateInsightRequest = AuthRequest<{
  title: string;
  text: string;
  tags?: string[];
  supportingExperimentIds: string[];
  contraryEvidence?: string[];
  projects?: string[];
  status?: string;
  source?: "ai" | "manual";
}>;

type CreateInsightResponse = {
  status: 200;
  insight: InsightInterface;
};

export const postInsight = async (
  req: CreateInsightRequest,
  res: Response<CreateInsightResponse>,
) => {
  const context = getContextFromReq(req);
  const {
    title,
    text,
    tags,
    supportingExperimentIds,
    contraryEvidence,
    projects,
    status,
    source,
  } = req.body;

  // Status validation and the "" no-status sentinel are enforced by the
  // model, shared with the external API path.
  const insight = await context.models.insights.create({
    owner: context.userId,
    authors: context.userId ? [context.userId] : [],
    title,
    text,
    tags: tags || [],
    supportingExperimentIds: supportingExperimentIds || [],
    contraryEvidence: contraryEvidence || [],
    projects: projects || [],
    status: status || "",
    source: source || "manual",
  });

  res.status(200).json({ status: 200, insight });
};

type UpdateInsightRequest = AuthRequest<
  {
    title?: string;
    text?: string;
    tags?: string[];
    supportingExperimentIds?: string[];
    contraryEvidence?: string[];
    projects?: string[];
    status?: string;
  },
  { id: string }
>;

export const putInsight = async (
  req: UpdateInsightRequest,
  res: Response<{ status: 200; insight: InsightInterface }>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const existing = await context.models.insights.getById(id);
  if (!existing) {
    throw new Error("Insight not found");
  }

  // Append the current user to authors if this is a meaningful edit they
  // haven't been credited for. The diff (including the new authors array)
  // will be captured automatically by the BaseModel audit log.
  const existingAuthors = existing.authors || [];
  const editor = context.userId;
  const nextAuthors =
    editor && !existingAuthors.includes(editor)
      ? [...existingAuthors, editor]
      : existingAuthors;

  // Status validation is enforced by the model (shared with the external API).
  const updates = { ...req.body, authors: nextAuthors };

  const updated = await context.models.insights.update(existing, updates);
  res.status(200).json({ status: 200, insight: updated });
};

export const deleteInsight = async (
  req: AuthRequest<Record<string, never>, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const existing = await context.models.insights.getById(id);
  if (!existing) {
    throw new Error("Insight not found");
  }
  await context.models.insights.delete(existing);
  res.status(200).json({ status: 200 });
};

// --- AI: Find Insights across experiments ---

type FindInsightsRequest = AuthRequest<{
  experimentIds: string[];
}>;

type FindInsightsResponse =
  | {
      status: 200;
      insights: AiInsightSuggestion[];
      numExperimentsRequested: number;
      numExperimentsAnalyzed: number;
    }
  | {
      status: number;
      message: string;
      retryAfter?: number;
    };

// Hard caps so one large org can't blow the model's context window (or run
// up unbounded token costs). When the experiment cap kicks in we analyze the
// most recently-stopped experiments and tell the front-end via
// numExperimentsRequested/numExperimentsAnalyzed.
// Bump when the prompt, output schema, or experiment summarization changes,
// so cached results from an older prompt aren't served.
const FIND_INSIGHTS_PROMPT_VERSION = 2;
const MAX_EXPERIMENTS_FOR_AI = 50;
const MAX_SAVED_INSIGHTS_IN_PROMPT = 100;
const MAX_ORG_TAGS_IN_PROMPT = 100;
// Per-field character caps for the experiment summaries sent to the AI
const MAX_HYPOTHESIS_CHARS = 600;
const MAX_DESCRIPTION_CHARS = 1500;
const MAX_ANALYSIS_CHARS = 2000;
const MAX_VARIATION_DESCRIPTION_CHARS = 300;
const MAX_SAVED_INSIGHT_TEXT_CHARS = 600;
// Candidates at or above this cosine similarity to a saved insight are
// dropped as duplicates (prompt-level dedup is soft; this is the hard check)
const SIMILARITY_DEDUP_THRESHOLD = 0.85;
// Saved insights normally get embeddings via InsightModel hooks; backfill at
// most this many missing ones inline per request
const MAX_SAVED_VECTOR_BACKFILL = 50;

function truncateForAI(s: string | undefined, maxChars: number): string {
  if (!s) return "";
  return s.length > maxChars ? s.slice(0, maxChars) + "…" : s;
}

function roundForAI(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// When stopped, an experiment's last phase end date is the best "recency"
// signal; fall back to dateUpdated for anything without phases.
function experimentRecency(exp: ExperimentInterface): number {
  const lastPhase = exp.phases?.[exp.phases.length - 1];
  const d = lastPhase?.dateEnded || exp.dateUpdated;
  return d ? new Date(d).getTime() : 0;
}

type AIMetricResult = {
  variation: string;
  metric: string;
  // Which direction of movement is good for this metric. "lower" for inverse
  // metrics (bounce rate, unsubscribes, latency, …) where a positive lift is
  // a regression, not a win.
  betterDirection: "higher" | "lower";
  lift?: number;
  chanceToWin?: number;
  pValue?: number;
};

// Compact per-variation goal-metric outcomes from the latest snapshot so the
// AI can weigh evidence quantitatively (a +12% significant win is stronger
// evidence than a barely-positive inconclusive result).
function summarizeSnapshotResultsForAI(
  exp: ExperimentInterface,
  snapshot: ExperimentSnapshotInterface | undefined,
  metricMap: Map<string, ExperimentMetricInterface>,
): AIMetricResult[] | undefined {
  const overall = snapshot?.analyses?.[0]?.results?.[0];
  const goalMetricIds = exp.goalMetrics || [];
  if (!overall || !goalMetricIds.length) return undefined;

  const rows: AIMetricResult[] = [];
  overall.variations.forEach((variation, i) => {
    if (i === 0) return; // baseline
    const variationName = exp.variations?.[i]?.name || `Variation ${i}`;
    goalMetricIds.forEach((metricId) => {
      const m = variation.metrics?.[metricId];
      if (!m) return;
      const metric = metricMap.get(metricId);
      const row: AIMetricResult = {
        variation: variationName,
        metric: metric?.name || metricId,
        betterDirection: metric?.inverse ? "lower" : "higher",
      };
      if (typeof m.expected === "number") {
        row.lift = roundForAI(m.expected);
      }
      if (typeof m.chanceToWin === "number") {
        row.chanceToWin = roundForAI(m.chanceToWin);
      }
      const pValue = m.pValueAdjusted ?? m.pValue;
      if (typeof pValue === "number") {
        row.pValue = roundForAI(pValue);
      }
      rows.push(row);
    });
  });
  return rows.length ? rows : undefined;
}

// Replace any internal experiment ids the model left in prose with the
// experiment name, so ids never surface in user-facing insight text.
function replaceExperimentIdsWithNames(
  text: string,
  idToName: Map<string, string>,
): string {
  let out = text;
  for (const [id, name] of idToName) {
    if (name && out.includes(id)) {
      out = out.split(id).join(name);
    }
  }
  return out;
}

// Build a compact, AI-friendly summary of an experiment to keep token usage low
function summarizeExperimentForAI(
  exp: ExperimentInterface,
  metricResults?: AIMetricResult[],
) {
  const variations = (exp.variations || []).map((v) => ({
    name: v.name,
    description: truncateForAI(v.description, MAX_VARIATION_DESCRIPTION_CHARS),
  }));
  return {
    id: exp.id,
    name: exp.name,
    hypothesis: truncateForAI(exp.hypothesis, MAX_HYPOTHESIS_CHARS),
    description: truncateForAI(exp.description, MAX_DESCRIPTION_CHARS),
    tags: exp.tags || [],
    status: exp.status,
    results: exp.results || "",
    analysis: truncateForAI(exp.analysis, MAX_ANALYSIS_CHARS),
    variations,
    winner: typeof exp.winner === "number" ? exp.winner : undefined,
    metricResults,
  };
}

// Hard dedup of AI candidates against saved insights using embedding cosine
// similarity. Saved-insight embeddings are maintained by InsightModel hooks;
// any missing ones (e.g. insights saved before embeddings existed, or while
// AI was disabled) are backfilled inline up to a cap.
async function filterCandidatesBySimilarity(
  context: ReqContext,
  candidates: AiInsightSuggestion[],
  savedInsights: InsightInterface[],
): Promise<AiInsightSuggestion[]> {
  if (!candidates.length || !savedInsights.length) return candidates;

  const vectors = await context.models.vectors.getByInsightIds(
    savedInsights.map((i) => i.id),
  );
  const savedEmbeddings = new Map(vectors.map((v) => [v.joinId, v.embeddings]));

  const missing = savedInsights
    .filter((i) => !savedEmbeddings.has(i.id))
    .slice(0, MAX_SAVED_VECTOR_BACKFILL);
  if (missing.length) {
    const embeddings = await generateEmbeddings({
      context,
      input: missing.map((i) => getInsightTextForEmbedding(i)),
    });
    await Promise.all(
      missing.map(async (insight, i) => {
        const embedding = embeddings[i];
        if (!embedding?.length) return;
        savedEmbeddings.set(insight.id, embedding);
        try {
          await context.models.vectors.addOrUpdateInsightVector(insight.id, {
            embeddings: embedding,
          });
        } catch (e) {
          logger.error(
            e,
            `Error storing backfilled embedding for insight ${insight.id}`,
          );
        }
      }),
    );
  }

  const saved = Array.from(savedEmbeddings.values());
  if (!saved.length) return candidates;

  const candidateEmbeddings = await generateEmbeddings({
    context,
    input: candidates.map((c) => getInsightTextForEmbedding(c)),
  });

  return candidates.filter((candidate, i) => {
    const embedding = candidateEmbeddings[i];
    if (!embedding?.length) return true;
    const isDuplicate = saved.some(
      (s) =>
        // Skip vectors from a different embedding model (dimension mismatch)
        s.length === embedding.length &&
        cosineSimilarity(embedding, s) >= SIMILARITY_DEDUP_THRESHOLD,
    );
    if (isDuplicate) {
      logger.info(
        `Dropping AI insight candidate "${candidate.title}" as a near-duplicate of a saved insight`,
      );
    }
    return !isDuplicate;
  });
}

export const postFindInsights = async (
  req: FindInsightsRequest,
  res: Response<FindInsightsResponse>,
) => {
  const context = getContextFromReq(req);

  // Premium feature, AI-enabled, and rate-limit gates (writes the error
  // response itself when a gate fails).
  if (!(await runAccessGates(context, res))) {
    return;
  }

  const { experimentIds } = req.body;
  if (!experimentIds || experimentIds.length < 2) {
    return res.status(400).json({
      status: 400,
      message:
        "At least 2 experiments are required to look for cross-experiment insights",
    });
  }

  // getExperimentsByIds filters to experiments the requesting user can read,
  // so everything downstream (including the cache key) is permission-scoped.
  const allExperiments = await getExperimentsByIds(context, experimentIds);
  if (allExperiments.length < 2) {
    return res.status(400).json({
      status: 400,
      message: "Could not load enough experiments to analyze",
    });
  }

  // Cap the analysis set, keeping the most recently-stopped experiments
  const numExperimentsRequested = allExperiments.length;
  const experiments = [...allExperiments]
    .sort((a, b) => experimentRecency(b) - experimentRecency(a))
    .slice(0, MAX_EXPERIMENTS_FOR_AI);
  const numExperimentsAnalyzed = experiments.length;
  if (numExperimentsAnalyzed < numExperimentsRequested) {
    logger.info(
      `find-insights: capping analysis to ${numExperimentsAnalyzed} of ${numExperimentsRequested} experiments for org ${context.org.id}`,
    );
  }

  // Pull existing saved insights for deduplication (both the prompt-level
  // instruction and the post-generation embedding check).
  const existingInsights = await context.models.insights.getAll();

  // Organization-specific context configured under General Settings →
  // Experiment Settings → Find Insights Context.
  const findInsightsPromptConfig = await context.models.aiPrompts.getAIPrompt(
    "find-insights-context",
  );
  const customContext = (findInsightsPromptConfig.prompt || "").trim();

  // Serve from cache when the same experiment set was analyzed recently and
  // the saved insights / prompt config haven't changed. The key fingerprints
  // the exact set of insights this user can read (id + version), not just a
  // count — otherwise two users in the same org with different read access
  // could collide on the same key and one could receive suggestions that were
  // deduplicated against the other's (unreadable) insights.
  const insightsFingerprint = existingInsights
    .map((i) => `${i.id}:${i.dateUpdated?.getTime() || 0}`)
    .sort();
  const cacheKey = createHash("sha256")
    .update(
      JSON.stringify({
        promptVersion: FIND_INSIGHTS_PROMPT_VERSION,
        experimentIds: experiments.map((e) => e.id).sort(),
        insightsFingerprint,
        customContext,
        overrideModel: findInsightsPromptConfig.overrideModel || "",
      }),
    )
    .digest("hex");

  try {
    const cached =
      await context.models.insightsFindCache.getValidByKey(cacheKey);
    if (cached) {
      return res.status(200).json({
        status: 200,
        insights: cached.suggestions,
        numExperimentsRequested,
        numExperimentsAnalyzed: cached.numExperimentsAnalyzed,
      });
    }
  } catch (e) {
    logger.error(e, "find-insights: error reading result cache");
  }

  // Enrich each experiment with compact quantitative results from its latest
  // snapshot. Best-effort: if this fails we still run the prompt with the
  // qualitative fields only.
  const resultsByExperimentId = new Map<string, AIMetricResult[]>();
  try {
    const phaseMap = new Map(
      experiments
        .filter((e) => (e.phases?.length || 0) > 0)
        .map((e) => [e.id, e.phases.length - 1]),
    );
    if (phaseMap.size) {
      const [snapshots, metricMap] = await Promise.all([
        getLatestSnapshotMultipleExperiments(context, phaseMap),
        getMetricMap(context),
      ]);
      const snapshotByExperimentId = new Map(
        snapshots.map((s) => [s.experiment, s]),
      );
      experiments.forEach((exp) => {
        const rows = summarizeSnapshotResultsForAI(
          exp,
          snapshotByExperimentId.get(exp.id),
          metricMap,
        );
        if (rows) resultsByExperimentId.set(exp.id, rows);
      });
    }
  } catch (e) {
    logger.error(e, "find-insights: error loading snapshot results");
  }

  const summaries = experiments.map((exp) =>
    summarizeExperimentForAI(exp, resultsByExperimentId.get(exp.id)),
  );

  // Saved-insight summaries for the prompt: title/text/tags only, most
  // recently updated first, capped
  const existingSummaries = [...existingInsights]
    .sort(
      (a, b) =>
        (b.dateUpdated?.getTime() || 0) - (a.dateUpdated?.getTime() || 0),
    )
    .slice(0, MAX_SAVED_INSIGHTS_IN_PROMPT)
    .map((i) => ({
      title: i.title,
      text: truncateForAI(i.text, MAX_SAVED_INSIGHT_TEXT_CHARS),
      tags: i.tags || [],
    }));

  let instructions =
    "You are an expert experimentation analyst. Your job is to read a set of A/B experiments and identify common themes, patterns, or insights that span multiple experiments. " +
    "Look for things like: shared psychological or design tactics that tend to work (or not work), audience preferences (e.g. color, copy tone, emotional appeals, urgency, social proof), recurring product behaviors, or patterns in what causes wins vs. losses. " +
    "Only surface insights that are supported by at least 2 of the experiments provided. " +
    "Some experiments include metricResults: per-variation outcomes for the experiment's goal metrics, with the relative lift, the Bayesian chance to win (0-1), and/or the frequentist p-value. Use these to weigh evidence — a large, statistically significant effect is much stronger support than a small or inconclusive one. " +
    "Each metricResults row includes betterDirection ('higher' or 'lower'), indicating which way is good for that metric. A change is only an improvement when the lift moves the metric in its better direction: a positive lift on a 'lower' metric (e.g. bounce rate, unsubscribes) is a REGRESSION, not a win. Judge wins and losses by betterDirection, never by the sign of the lift alone. " +
    "Be rigorous about evidence quality. Do NOT infer a pattern from inconclusive or underpowered experiments — an experiment with no statistically significant movement is 'no result', which is different from evidence of 'no effect'. Treat a result as supporting or contrary only when its metrics actually moved significantly. Prefer a few well-evidenced insights over many speculative ones. " +
    "When multiple experiments involve the same goal metric (matched by metric name), treat that as a strong signal they may be related and evaluate them together. Judge whether they agree by reasoning about WHAT each variation changed, not by the raw direction the metric moved: two experiments can support the SAME underlying insight even when the shared metric moved in OPPOSITE directions, as long as their treatments were opposite manipulations. For example, one test that simplifies the signup flow and raises signups and another that adds complexity to the signup flow and lowers signups BOTH support 'users prefer a simpler signup flow'. So do NOT treat opposite movement on a shared metric as contradictory by default — only count something as contrary evidence when a similar change produced a genuinely inconsistent effect. Corroborating shared-metric evidence like this should raise confidence and ranking. Do NOT require a shared metric, though — patterns that span experiments without a common goal metric (shared tactics, audiences, or product behaviors) are still valid insights. " +
    "For each insight, return a short title, a paragraph (or two) of markdown explaining the pattern and what the evidence is (ending with a concrete, actionable recommendation for what the team should try or do next), a confidence level, 1-5 lowercase hyphenated tags categorizing it, the list of experiment ids that support it, and the list of experiment ids whose outcomes run counter to the insight (contraryExperimentIds). " +
    "Contrary evidence should include experiments in the input set whose results materially disagree with the insight — e.g. the pattern was tried and did NOT win, or produced the opposite effect. If no contrary evidence exists in the input set, return an empty list for contraryExperimentIds. Do not include the same experiment as both supporting and contrary. " +
    "Use only experiment ids from the input set. Return at most 8 insights, ordered from most to least confident, with the confidence field reflecting how strongly the provided evidence supports each one. " +
    "In the human-facing title and text, always refer to experiments by their name, never by their id. Experiment ids must appear only in the supportingExperimentIds and contraryExperimentIds arrays — never in the prose. " +
    "If no meaningful cross-experiment patterns exist, return an empty list. " +
    "IMPORTANT: A list of insights that the team has ALREADY SAVED is provided. Do not duplicate or paraphrase those — only surface genuinely new patterns. If a candidate insight overlaps meaningfully with a saved one, omit it.";

  // Encourage reuse of the org's existing tag vocabulary so the tag filter
  // doesn't fragment into near-duplicates over time.
  try {
    const orgTags = await getAllTags(context.org.id);
    const tagNames = orgTags.slice(0, MAX_ORG_TAGS_IN_PROMPT).map((t) => t.id);
    if (tagNames.length) {
      instructions +=
        "\n\nWhen choosing tags, prefer reusing these existing tags over inventing near-duplicates (only create a new tag when none of these fit): " +
        tagNames.join(", ");
    }
  } catch (e) {
    logger.error(e, "find-insights: error loading org tags");
  }

  if (customContext) {
    instructions +=
      "\n\nAdditional organization-specific context about the product, audience, and what counts as a meaningful insight:\n" +
      customContext;
  }

  const prompt =
    "Here are the experiments to analyze (as JSON). Each has an id, name, hypothesis, description, tags, status, results, an AI-written or human-written analysis summary, the variations tested, and (when available) metricResults with per-variation goal metric outcomes:\n\n" +
    JSON.stringify(summaries) +
    "\n\nHere are the insights the team has ALREADY saved (do not duplicate these):\n\n" +
    JSON.stringify(existingSummaries);

  try {
    const aiResponse = await parsePrompt({
      context,
      instructions,
      prompt,
      type: "find-insights-context",
      isDefaultPrompt: !customContext,
      overrideModel: findInsightsPromptConfig.overrideModel,
      temperature: 0.4,
      zodObjectSchema: aiInsightSuggestionsResponseValidator,
    });

    // Filter to ids that actually exist in the input set (defense against AI
    // hallucinating ids), and ensure an experiment never appears on both lists.
    const validIds = new Set(experiments.map((e) => e.id));
    // Safety net: even with the prompt instruction, the model can occasionally
    // reference an experiment by id in the prose. Swap any such id for its name
    // so internal ids never surface in user-facing text.
    const idToName = new Map(experiments.map((e) => [e.id, e.name]));
    const cleaned = (aiResponse.insights || [])
      .map((i) => {
        const supporting = (i.supportingExperimentIds || []).filter((id) =>
          validIds.has(id),
        );
        const supportingSet = new Set(supporting);
        const contrary = (i.contraryExperimentIds || []).filter(
          (id) => validIds.has(id) && !supportingSet.has(id),
        );
        return {
          ...i,
          title: replaceExperimentIdsWithNames(i.title, idToName),
          text: replaceExperimentIdsWithNames(i.text, idToName),
          supportingExperimentIds: supporting,
          contraryExperimentIds: contrary,
        };
      })
      .filter((i) => i.supportingExperimentIds.length >= 2);

    // Hard dedup against saved insights via embeddings. Best-effort: fall
    // back to the prompt-level dedup if embeddings fail.
    let deduped = cleaned;
    try {
      deduped = await filterCandidatesBySimilarity(
        context,
        cleaned,
        existingInsights,
      );
    } catch (e) {
      logger.error(e, "find-insights: error running embedding dedup");
    }

    try {
      await context.models.insightsFindCache.set(cacheKey, {
        suggestions: deduped,
        numExperimentsRequested,
        numExperimentsAnalyzed,
      });
    } catch (e) {
      logger.error(e, "find-insights: error writing result cache");
    }

    return res.status(200).json({
      status: 200,
      insights: deduped,
      numExperimentsRequested,
      numExperimentsAnalyzed,
    });
  } catch (e) {
    return res.status(500).json({
      status: 500,
      message: e instanceof Error ? e.message : "Failed to generate insights",
    });
  }
};
