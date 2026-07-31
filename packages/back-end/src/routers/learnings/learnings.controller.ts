import type { Response } from "express";
import {
  LearningInterface,
  LearningRefreshSuggestion,
  aiLearningRefreshValidator,
  aiLearningSuggestionsResponseValidator,
  AiLearningSuggestion,
} from "shared/validators";
import { ExperimentInterface } from "shared/types/experiment";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { ExperimentMetricInterface } from "shared/experiments";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ReqContext } from "back-end/types/request";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getLearningTextForEmbedding } from "back-end/src/models/LearningModel";
import {
  cosineSimilarity,
  generateEmbeddings,
  parsePrompt,
} from "back-end/src/enterprise/services/ai";
import { runAccessGates } from "back-end/src/enterprise/services/ai-access";
import {
  getAllExperiments,
  getExperimentsByIds,
} from "back-end/src/models/ExperimentModel";
import { getLatestSnapshotMultipleExperiments } from "back-end/src/models/ExperimentSnapshotModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { getAllTags } from "back-end/src/models/TagModel";
import { logger } from "back-end/src/util/logger";

type LearningWithCanManage = LearningInterface & { canManage: boolean };

type ListLearningsResponse = {
  status: 200;
  learnings: LearningWithCanManage[];
};

export const getLearnings = async (
  req: AuthRequest<unknown, unknown, { project?: string }>,
  res: Response<ListLearningsResponse>,
) => {
  const context = getContextFromReq(req);
  const project =
    typeof req.query?.project === "string" ? req.query.project : "";

  const allLearnings = await context.models.learnings.getAll();

  // Scope to the current project. Learnings with no projects live in
  // "All projects" and are always included (same convention as metrics,
  // segments, and other multi-project resources).
  const learnings = project
    ? allLearnings.filter(
        (i) => !i.projects?.length || i.projects.includes(project),
      )
    : allLearnings;

  res.status(200).json({
    status: 200,
    learnings: learnings.map((i) => ({
      ...i,
      canManage: context.models.learnings.canManageLearning(i),
    })),
  });
};

export const getLearning = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200; learning: LearningWithCanManage }>,
) => {
  const context = getContextFromReq(req);
  const learning = await context.models.learnings.getById(req.params.id);
  if (!learning) {
    throw new Error("Learning not found");
  }
  res.status(200).json({
    status: 200,
    learning: {
      ...learning,
      canManage: context.models.learnings.canManageLearning(learning),
    },
  });
};

type CreateLearningRequest = AuthRequest<{
  title: string;
  text: string;
  tags?: string[];
  supportingExperimentIds: string[];
  contradictingExperimentIds?: string[];
  projects?: string[];
  status?: string;
  source?: "ai" | "manual";
}>;

type CreateLearningResponse = {
  status: 200;
  learning: LearningInterface;
};

export const postLearning = async (
  req: CreateLearningRequest,
  res: Response<CreateLearningResponse>,
) => {
  const context = getContextFromReq(req);
  const {
    title,
    text,
    tags,
    supportingExperimentIds,
    contradictingExperimentIds,
    projects,
    status,
    source,
  } = req.body;

  // Status validation and the "" no-status sentinel are enforced by the
  // model, shared with the external API path.
  const learning = await context.models.learnings.create({
    owner: context.userId,
    authors: context.userId ? [context.userId] : [],
    title,
    text,
    tags: tags || [],
    supportingExperimentIds: supportingExperimentIds || [],
    contradictingExperimentIds: contradictingExperimentIds || [],
    projects: projects || [],
    status: status || "",
    source: source || "manual",
  });

  res.status(200).json({ status: 200, learning });
};

type UpdateLearningRequest = AuthRequest<
  {
    title?: string;
    text?: string;
    tags?: string[];
    supportingExperimentIds?: string[];
    contradictingExperimentIds?: string[];
    projects?: string[];
    status?: string;
  },
  { id: string }
>;

export const putLearning = async (
  req: UpdateLearningRequest,
  res: Response<{ status: 200; learning: LearningInterface }>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const existing = await context.models.learnings.getById(id);
  if (!existing) {
    throw new Error("Learning not found");
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

  const updated = await context.models.learnings.update(existing, updates);
  res.status(200).json({ status: 200, learning: updated });
};

export const deleteLearning = async (
  req: AuthRequest<Record<string, never>, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const existing = await context.models.learnings.getById(id);
  if (!existing) {
    throw new Error("Learning not found");
  }
  await context.models.learnings.delete(existing);
  res.status(200).json({ status: 200 });
};

// --- AI: Find Learnings across experiments ---

type FindLearningsRequest = AuthRequest<{
  experimentIds: string[];
}>;

type FindLearningsResponse =
  | {
      status: 200;
      learnings: AiLearningSuggestion[];
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
const MAX_EXPERIMENTS_FOR_AI = 50;
const MAX_SAVED_LEARNINGS_IN_PROMPT = 100;
const MAX_ORG_TAGS_IN_PROMPT = 100;
// Per-field character caps for the experiment summaries sent to the AI
const MAX_HYPOTHESIS_CHARS = 600;
const MAX_DESCRIPTION_CHARS = 1500;
const MAX_ANALYSIS_CHARS = 2000;
const MAX_VARIATION_DESCRIPTION_CHARS = 300;
const MAX_SAVED_LEARNING_TEXT_CHARS = 600;
// Candidates at or above this cosine similarity to a saved learning are
// dropped as duplicates (prompt-level dedup is soft; this is the hard check)
const SIMILARITY_DEDUP_THRESHOLD = 0.85;
// Saved learnings normally get embeddings via LearningModel hooks; backfill at
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
      const row: AIMetricResult = {
        variation: variationName,
        metric: metricMap.get(metricId)?.name || metricId,
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

// Hard dedup of AI candidates against saved learnings using embedding cosine
// similarity. Saved-learning embeddings are maintained by LearningModel hooks;
// any missing ones (e.g. learnings saved before embeddings existed, or while
// AI was disabled) are backfilled inline up to a cap.
async function filterCandidatesBySimilarity(
  context: ReqContext,
  candidates: AiLearningSuggestion[],
  savedLearnings: LearningInterface[],
): Promise<AiLearningSuggestion[]> {
  if (!candidates.length || !savedLearnings.length) return candidates;

  const vectors = await context.models.vectors.getByLearningIds(
    savedLearnings.map((i) => i.id),
  );
  const savedEmbeddings = new Map(vectors.map((v) => [v.joinId, v.embeddings]));

  const missing = savedLearnings
    .filter((i) => !savedEmbeddings.has(i.id))
    .slice(0, MAX_SAVED_VECTOR_BACKFILL);
  if (missing.length) {
    const embeddings = await generateEmbeddings({
      context,
      input: missing.map((i) => getLearningTextForEmbedding(i)),
    });
    await Promise.all(
      missing.map(async (learning, i) => {
        const embedding = embeddings[i];
        if (!embedding?.length) return;
        savedEmbeddings.set(learning.id, embedding);
        try {
          await context.models.vectors.addOrUpdateLearningVector(learning.id, {
            embeddings: embedding,
          });
        } catch (e) {
          logger.error(
            e,
            `Error storing backfilled embedding for learning ${learning.id}`,
          );
        }
      }),
    );
  }

  const saved = Array.from(savedEmbeddings.values());
  if (!saved.length) return candidates;

  const candidateEmbeddings = await generateEmbeddings({
    context,
    input: candidates.map((c) => getLearningTextForEmbedding(c)),
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
        `Dropping AI learning candidate "${candidate.title}" as a near-duplicate of a saved learning`,
      );
    }
    return !isDuplicate;
  });
}

export const postFindLearnings = async (
  req: FindLearningsRequest,
  res: Response<FindLearningsResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.hasPremiumFeature("learnings")) {
    return res.status(403).json({
      status: 403,
      message: "Learnings requires an Enterprise plan.",
    });
  }

  // AI-enabled and rate-limit gates (writes the error response itself when a
  // gate fails).
  if (!(await runAccessGates(context, res))) {
    return;
  }

  const { experimentIds } = req.body;
  if (!experimentIds || experimentIds.length < 2) {
    return res.status(400).json({
      status: 400,
      message:
        "At least 2 experiments are required to look for cross-experiment learnings",
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
      `find-learnings: capping analysis to ${numExperimentsAnalyzed} of ${numExperimentsRequested} experiments for org ${context.org.id}`,
    );
  }

  // Pull existing saved learnings for deduplication (both the prompt-level
  // instruction and the post-generation embedding check).
  const existingLearnings = await context.models.learnings.getAll();

  // Organization-specific context configured under General Settings →
  // Experiment Settings → Find Learnings Context.
  const findLearningsPromptConfig = await context.models.aiPrompts.getAIPrompt(
    "find-learnings-context",
  );
  const customContext = (findLearningsPromptConfig.prompt || "").trim();

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
    logger.error(e, "find-learnings: error loading snapshot results");
  }

  const summaries = experiments.map((exp) =>
    summarizeExperimentForAI(exp, resultsByExperimentId.get(exp.id)),
  );

  // Saved-learning summaries for the prompt: title/text/tags only, most
  // recently updated first, capped
  const existingSummaries = [...existingLearnings]
    .sort(
      (a, b) =>
        (b.dateUpdated?.getTime() || 0) - (a.dateUpdated?.getTime() || 0),
    )
    .slice(0, MAX_SAVED_LEARNINGS_IN_PROMPT)
    .map((i) => ({
      title: i.title,
      text: truncateForAI(i.text, MAX_SAVED_LEARNING_TEXT_CHARS),
      tags: i.tags || [],
    }));

  let instructions =
    "You are an expert experimentation analyst. Your job is to read a set of A/B experiments and identify common themes, patterns, or learnings that span multiple experiments. " +
    "Look for things like: shared psychological or design tactics that tend to work (or not work), audience preferences (e.g. color, copy tone, emotional appeals, urgency, social proof), recurring product behaviors, or patterns in what causes wins vs. losses. " +
    "Only surface learnings that are supported by at least 2 of the experiments provided. " +
    "Some experiments include metricResults: per-variation outcomes for the experiment's goal metrics, with the relative lift, the Bayesian chance to win (0-1), and/or the frequentist p-value. Use these to weigh evidence — a large, statistically significant effect is much stronger support than a small or inconclusive one. " +
    "For each learning, return a short title, a paragraph (or two) of markdown explaining the pattern and what the evidence is, 1-5 lowercase hyphenated tags categorizing it, the list of experiment ids that support it, and the list of experiment ids whose outcomes run counter to the learning (contradictingExperimentIds). " +
    "Contrary evidence should include experiments in the input set whose results materially disagree with the learning — e.g. the pattern was tried and did NOT win, or produced the opposite effect. If no contrary evidence exists in the input set, return an empty list for contradictingExperimentIds. Do not include the same experiment as both supporting and contrary. " +
    "Use only experiment ids from the input set. Return at most 8 learnings, ordered from most to least confident. " +
    "If no meaningful cross-experiment patterns exist, return an empty list. " +
    "IMPORTANT: A list of learnings that the team has ALREADY SAVED is provided. Do not duplicate or paraphrase those — only surface genuinely new patterns. If a candidate learning overlaps meaningfully with a saved one, omit it.";

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
    logger.error(e, "find-learnings: error loading org tags");
  }

  if (customContext) {
    instructions +=
      "\n\nAdditional organization-specific context about the product, audience, and what counts as a meaningful learning:\n" +
      customContext;
  }

  const prompt =
    "Here are the experiments to analyze (as JSON). Each has an id, name, hypothesis, description, tags, status, results, an AI-written or human-written analysis summary, the variations tested, and (when available) metricResults with per-variation goal metric outcomes:\n\n" +
    JSON.stringify(summaries) +
    "\n\nHere are the learnings the team has ALREADY saved (do not duplicate these):\n\n" +
    JSON.stringify(existingSummaries);

  try {
    const aiResponse = await parsePrompt({
      context,
      instructions,
      prompt,
      type: "find-learnings-context",
      isDefaultPrompt: !customContext,
      overrideModel: findLearningsPromptConfig.overrideModel,
      temperature: 0.4,
      zodObjectSchema: aiLearningSuggestionsResponseValidator,
    });

    // Filter to ids that actually exist in the input set (defense against AI
    // hallucinating ids), and ensure an experiment never appears on both lists.
    const validIds = new Set(experiments.map((e) => e.id));
    const cleaned = (aiResponse.learnings || [])
      .map((i) => {
        const supporting = (i.supportingExperimentIds || []).filter((id) =>
          validIds.has(id),
        );
        const supportingSet = new Set(supporting);
        const contrary = (i.contradictingExperimentIds || []).filter(
          (id) => validIds.has(id) && !supportingSet.has(id),
        );
        return {
          ...i,
          supportingExperimentIds: supporting,
          contradictingExperimentIds: contrary,
        };
      })
      .filter((i) => i.supportingExperimentIds.length >= 2);

    // Hard dedup against saved learnings via embeddings. Best-effort: fall
    // back to the prompt-level dedup if embeddings fail.
    let deduped = cleaned;
    try {
      deduped = await filterCandidatesBySimilarity(
        context,
        cleaned,
        existingLearnings,
      );
    } catch (e) {
      logger.error(e, "find-learnings: error running embedding dedup");
    }

    return res.status(200).json({
      status: 200,
      learnings: deduped,
      numExperimentsRequested,
      numExperimentsAnalyzed,
    });
  } catch (e) {
    return res.status(500).json({
      status: 500,
      message: e instanceof Error ? e.message : "Failed to generate learnings",
    });
  }
};

// --- AI: Refresh saved Learnings against newly-stopped experiments ---

type RefreshLearningsRequest = AuthRequest<{
  learningIds?: string[];
}>;

type RefreshLearningsResponse =
  | {
      status: 200;
      suggestions: LearningRefreshSuggestion[];
      numLearningsChecked: number;
      numExperimentsConsidered: number;
    }
  | { status: number; message: string; retryAfter?: number };

// Only re-check a Learning against experiments that stopped after the newest
// experiment it already cites, or after its last refresh — whichever is later.
function refreshCutoffFor(
  learning: LearningInterface,
  experimentsById: Map<string, ExperimentInterface>,
): number {
  const citedRecency = [
    ...learning.supportingExperimentIds,
    ...learning.contradictingExperimentIds,
  ].reduce((max, id) => {
    const exp = experimentsById.get(id);
    return exp ? Math.max(max, experimentRecency(exp)) : max;
  }, 0);
  return Math.max(citedRecency, learning.lastRefreshedAt?.getTime() || 0);
}

export const postRefreshLearnings = async (
  req: RefreshLearningsRequest,
  res: Response<RefreshLearningsResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.hasPremiumFeature("learnings")) {
    return res.status(403).json({
      status: 403,
      message: "Learnings requires an Enterprise plan.",
    });
  }

  if (!(await runAccessGates(context, res))) {
    return;
  }

  const { learningIds } = req.body;
  const allLearnings = await context.models.learnings.getAll();
  const learnings = learningIds?.length
    ? allLearnings.filter((l) => learningIds.includes(l.id))
    : allLearnings;

  if (!learnings.length) {
    return res.status(200).json({
      status: 200,
      suggestions: [],
      numLearningsChecked: 0,
      numExperimentsConsidered: 0,
    });
  }

  // Stopped experiments the user can read, most recent first
  const stopped = (await getAllExperiments(context, { includeArchived: false }))
    .filter((e) => e.status === "stopped")
    .sort((a, b) => experimentRecency(b) - experimentRecency(a));
  const experimentsById = new Map(stopped.map((e) => [e.id, e]));

  const promptConfig = await context.models.aiPrompts.getAIPrompt(
    "find-learnings-context",
  );
  const customContext = (promptConfig.prompt || "").trim();

  const suggestions: LearningRefreshSuggestion[] = [];
  const refreshedIds: string[] = [];
  let numExperimentsConsidered = 0;

  for (const learning of learnings) {
    const cutoff = refreshCutoffFor(learning, experimentsById);
    const cited = new Set([
      ...learning.supportingExperimentIds,
      ...learning.contradictingExperimentIds,
    ]);
    const candidates = stopped
      .filter((e) => !cited.has(e.id) && experimentRecency(e) > cutoff)
      .slice(0, MAX_EXPERIMENTS_FOR_AI);

    // Nothing new since the last check — still stamp it so the next run
    // doesn't reconsider the same window.
    if (!candidates.length) {
      refreshedIds.push(learning.id);
      continue;
    }
    numExperimentsConsidered += candidates.length;

    let instructions =
      "You are an expert experimentation analyst. You are given one saved Learning and a set of experiments that finished AFTER that Learning was last reviewed. " +
      "Decide whether the new experiments support, contradict, or do not affect the Learning. " +
      "Set stillAccurate to false only when the new evidence materially contradicts it. " +
      "In updatedText, return the Learning's markdown revised to incorporate the new evidence — or the original text unchanged when nothing needs to change. " +
      "Only cite experiment ids from the provided new-experiment set. Keep the summary to one sentence.";
    if (customContext) {
      instructions +=
        "\n\nAdditional organization-specific context:\n" + customContext;
    }

    const prompt =
      "Saved Learning (JSON):\n\n" +
      JSON.stringify({
        title: learning.title,
        text: truncateForAI(learning.text, MAX_SAVED_LEARNING_TEXT_CHARS),
        tags: learning.tags,
      }) +
      "\n\nExperiments that finished since it was last reviewed (JSON):\n\n" +
      JSON.stringify(candidates.map((e) => summarizeExperimentForAI(e)));

    try {
      const ai = await parsePrompt({
        context,
        instructions,
        prompt,
        type: "find-learnings-context",
        isDefaultPrompt: !customContext,
        overrideModel: promptConfig.overrideModel,
        temperature: 0.3,
        zodObjectSchema: aiLearningRefreshValidator,
      });

      const validIds = new Set(candidates.map((e) => e.id));
      const newSupporting = (ai.newSupportingExperimentIds || []).filter((id) =>
        validIds.has(id),
      );
      const supportingSet = new Set(newSupporting);
      const newContradicting = (ai.newContradictingExperimentIds || []).filter(
        (id) => validIds.has(id) && !supportingSet.has(id),
      );

      // Only surface a suggestion when there is something to act on.
      const hasChange =
        !ai.stillAccurate ||
        newSupporting.length > 0 ||
        newContradicting.length > 0 ||
        (ai.updatedText && ai.updatedText.trim() !== learning.text.trim());

      if (hasChange) {
        suggestions.push({
          learningId: learning.id,
          title: learning.title,
          stillAccurate: ai.stillAccurate,
          updatedText: ai.updatedText || learning.text,
          currentText: learning.text,
          newSupportingExperimentIds: newSupporting,
          newContradictingExperimentIds: newContradicting,
          summary: ai.summary || "",
        });
      }
      refreshedIds.push(learning.id);
    } catch (e) {
      // One failed Learning shouldn't abort the whole refresh
      logger.error(e, `refresh-learnings: error refreshing ${learning.id}`);
    }
  }

  // Stamp what we actually checked so the next run starts from here
  await Promise.all(
    refreshedIds.map(async (id) => {
      const doc = learnings.find((l) => l.id === id);
      if (!doc) return;
      try {
        await context.models.learnings.update(doc, {
          lastRefreshedAt: new Date(),
        });
      } catch (e) {
        logger.error(e, `refresh-learnings: error stamping ${id}`);
      }
    }),
  );

  return res.status(200).json({
    status: 200,
    suggestions,
    numLearningsChecked: learnings.length,
    numExperimentsConsidered,
  });
};

// Apply one reviewed refresh suggestion to its Learning.
export const postApplyLearningRefresh = async (
  req: AuthRequest<
    {
      text?: string;
      addSupportingExperimentIds?: string[];
      addContradictingExperimentIds?: string[];
    },
    { id: string }
  >,
  res: Response<{ status: 200; learning: LearningInterface }>,
) => {
  const context = getContextFromReq(req);
  const existing = await context.models.learnings.getById(req.params.id);
  if (!existing) {
    throw new Error("Learning not found");
  }

  const { text, addSupportingExperimentIds, addContradictingExperimentIds } =
    req.body;

  const supporting = new Set(existing.supportingExperimentIds);
  (addSupportingExperimentIds || []).forEach((id) => supporting.add(id));
  const contradicting = new Set(existing.contradictingExperimentIds);
  (addContradictingExperimentIds || []).forEach((id) => {
    if (!supporting.has(id)) contradicting.add(id);
  });

  const editor = context.userId;
  const authors =
    editor && !existing.authors.includes(editor)
      ? [...existing.authors, editor]
      : existing.authors;

  const updated = await context.models.learnings.update(existing, {
    ...(text !== undefined ? { text } : {}),
    supportingExperimentIds: [...supporting],
    contradictingExperimentIds: [...contradicting],
    authors,
    lastRefreshedAt: new Date(),
  });

  res.status(200).json({ status: 200, learning: updated });
};
