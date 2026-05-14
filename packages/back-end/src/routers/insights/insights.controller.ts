import type { Response } from "express";
import {
  InsightInterface,
  aiInsightSuggestionsResponseValidator,
  AiInsightSuggestion,
} from "shared/validators";
import { ExperimentInterface } from "shared/types/experiment";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  getAISettingsForOrg,
  getContextFromReq,
} from "back-end/src/services/organizations";
import {
  parsePrompt,
  secondsUntilAICanBeUsedAgain,
} from "back-end/src/enterprise/services/ai";
import { getExperimentsByIds } from "back-end/src/models/ExperimentModel";

type ListInsightsResponse = {
  status: 200;
  insights: InsightInterface[];
};

export const getInsights = async (
  req: AuthRequest,
  res: Response<ListInsightsResponse>,
) => {
  const context = getContextFromReq(req);
  const insights = await context.models.insights.getAll();
  res.status(200).json({ status: 200, insights });
};

type CreateInsightRequest = AuthRequest<{
  title: string;
  text: string;
  tags?: string[];
  supportingExperimentIds: string[];
  contraryEvidence?: string[];
  projects?: string[];
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
  } = req.body;

  const insight = await context.models.insights.create({
    owner: context.userId,
    authors: context.userId ? [context.userId] : [],
    title,
    text,
    tags: tags || [],
    supportingExperimentIds: supportingExperimentIds || [],
    contraryEvidence: contraryEvidence || [],
    projects: projects || [],
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
    }
  | {
      status: number;
      message: string;
      retryAfter?: number;
    };

// Build a compact, AI-friendly summary of an experiment to keep token usage low
function summarizeExperimentForAI(exp: ExperimentInterface) {
  const variations = (exp.variations || []).map((v) => ({
    name: v.name,
    description: v.description || "",
  }));
  return {
    id: exp.id,
    name: exp.name,
    hypothesis: exp.hypothesis || "",
    description: exp.description || "",
    tags: exp.tags || [],
    status: exp.status,
    results: exp.results || "",
    analysis: exp.analysis || "",
    variations,
    winner: typeof exp.winner === "number" ? exp.winner : undefined,
  };
}

export const postFindInsights = async (
  req: FindInsightsRequest,
  res: Response<FindInsightsResponse>,
) => {
  const context = getContextFromReq(req);
  const { aiEnabled } = getAISettingsForOrg(context);

  if (!aiEnabled) {
    return res.status(404).json({
      status: 404,
      message: "AI is not enabled for this organization",
    });
  }

  const secondsUntilReset = await secondsUntilAICanBeUsedAgain(context.org);
  if (secondsUntilReset > 0) {
    return res.status(429).json({
      status: 429,
      message: "Over AI usage limits",
      retryAfter: secondsUntilReset,
    });
  }

  const { experimentIds } = req.body;
  if (!experimentIds || experimentIds.length < 2) {
    return res.status(400).json({
      status: 400,
      message:
        "At least 2 experiments are required to look for cross-experiment insights",
    });
  }

  const experiments = await getExperimentsByIds(context, experimentIds);
  if (experiments.length < 2) {
    return res.status(400).json({
      status: 400,
      message: "Could not load enough experiments to analyze",
    });
  }

  const summaries = experiments.map(summarizeExperimentForAI);

  // Pull existing saved insights to give the AI deduplication context.
  // We only send the title/text/tags — enough to recognize overlap without
  // leaking unrelated structure.
  const existingInsights = await context.models.insights.getAll();
  const existingSummaries = existingInsights.map((i) => ({
    title: i.title,
    text: i.text,
    tags: i.tags || [],
  }));

  const instructions =
    "You are an expert experimentation analyst. Your job is to read a set of A/B experiments and identify common themes, patterns, or insights that span multiple experiments. " +
    "Look for things like: shared psychological or design tactics that tend to work (or not work), audience preferences (e.g. color, copy tone, emotional appeals, urgency, social proof), recurring product behaviors, or patterns in what causes wins vs. losses. " +
    "Only surface insights that are supported by at least 2 of the experiments provided. " +
    "For each insight, return a short title, a paragraph (or two) of markdown explaining the pattern and what the evidence is, 1-5 lowercase hyphenated tags categorizing it, the list of experiment ids that support it, and the list of experiment ids whose outcomes run counter to the insight (contraryExperimentIds). " +
    "Contrary evidence should include experiments in the input set whose results materially disagree with the insight — e.g. the pattern was tried and did NOT win, or produced the opposite effect. If no contrary evidence exists in the input set, return an empty list for contraryExperimentIds. Do not include the same experiment as both supporting and contrary. " +
    "Use only experiment ids from the input set. Return at most 8 insights, ordered from most to least confident. " +
    "If no meaningful cross-experiment patterns exist, return an empty list. " +
    "IMPORTANT: A list of insights that the team has ALREADY SAVED is provided. Do not duplicate or paraphrase those — only surface genuinely new patterns. If a candidate insight overlaps meaningfully with a saved one, omit it.";

  const prompt =
    "Here are the experiments to analyze (as JSON). Each has an id, name, hypothesis, description, tags, status, results, an AI-written or human-written analysis summary, and the variations tested:\n\n" +
    JSON.stringify(summaries) +
    "\n\nHere are the insights the team has ALREADY saved (do not duplicate these):\n\n" +
    JSON.stringify(existingSummaries);

  try {
    const aiResponse = await parsePrompt({
      context,
      instructions,
      prompt,
      type: "experiment-analysis",
      isDefaultPrompt: true,
      temperature: 0.4,
      zodObjectSchema: aiInsightSuggestionsResponseValidator,
    });

    // Filter to ids that actually exist in the input set (defense against AI
    // hallucinating ids), and ensure an experiment never appears on both lists.
    const validIds = new Set(experiments.map((e) => e.id));
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
          supportingExperimentIds: supporting,
          contraryExperimentIds: contrary,
        };
      })
      .filter((i) => i.supportingExperimentIds.length >= 2);

    return res.status(200).json({ status: 200, insights: cleaned });
  } catch (e) {
    return res.status(500).json({
      status: 500,
      message: e instanceof Error ? e.message : "Failed to generate insights",
    });
  }
};
