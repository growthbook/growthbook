import { z } from "zod";
import { findVisualChangesetById } from "back-end/src/models/VisualChangesetModel";
import {
  getAllExperiments,
  getExperimentById,
} from "back-end/src/models/ExperimentModel";
import {
  parsePrompt,
  secondsUntilAICanBeUsedAgain,
} from "back-end/src/enterprise/services/ai";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { logger } from "back-end/src/util/logger";
import { requireUserAuth } from "./requireUserAuth";

const pageHintsSchema = z.object({
  url: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  headings: z.array(z.string()).max(20).optional(),
});

const bodySchema = z
  .object({
    visualChangesetId: z.string(),
    pageHints: pageHintsSchema.optional(),
  })
  .strict();

const validation = {
  bodySchema,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.any(),
  method: "post" as const,
  path: "/visual-editor/ai/suggestions",
  operationId: "postVisualEditorAISuggestions",
};

const outputSchema = z.object({
  suggestions: z
    .array(z.string().min(8).max(140))
    .min(3)
    .max(4)
    .describe("3 to 4 short, action-oriented test ideas for the current page."),
});

const instructions = `You suggest 3 to 4 short, action-oriented A/B test prompts a user could try on a specific web page they're editing. Each prompt should be one sentence the user could send to the visual-editor AI (e.g. "Make the headline shorter and lead with the value prop").

Hard rules:
- Each suggestion is a single sentence (under 14 words), imperative, written as if the user is asking for the change.
- Suggestions must be concrete (mention a specific element type like headline / CTA / hero image / pricing, or a specific tactic like adding social proof, removing friction, shortening copy).
- Suggestions must be grounded in the current page and the experiment context. If you see relevant past experiments (especially ones that won or lost), bias toward repeating winning tactics in new places and avoiding repeats of losers — but say it positively.
- Do NOT propose suggestions that conflict with what the user already has in their current changeset (you don't have that data here, so just stay focused on the page and past learnings).
- If you have no past-experiment data, still produce 3 to 4 sensible ideas based on common visual-experiment patterns (hero copy, CTA color/copy, social proof, urgency, pricing emphasis, form simplification, image relevance).
- Don't suggest backend changes, traffic-splitting, sample size, or anything not directly visual.`;

interface PastExperimentSummary {
  name: string;
  hypothesis?: string;
  description?: string;
  status: string;
  analysis?: string;
}

function buildPrompt({
  currentExperiment,
  pageHints,
  pastExperiments,
}: {
  currentExperiment: {
    name: string;
    hypothesis?: string;
    description?: string;
  };
  pageHints?: z.infer<typeof pageHintsSchema>;
  pastExperiments: PastExperimentSummary[];
}): string {
  const currentBlock = `Current experiment:\n- Name: ${currentExperiment.name}\n${
    currentExperiment.hypothesis
      ? `- Hypothesis: ${currentExperiment.hypothesis}\n`
      : ""
  }${
    currentExperiment.description
      ? `- Description: ${currentExperiment.description}\n`
      : ""
  }`;

  const pageBlock = pageHints
    ? `\nPage being edited:\n${pageHints.url ? `- URL: ${pageHints.url}\n` : ""}${
        pageHints.title ? `- Title: ${pageHints.title}\n` : ""
      }${pageHints.description ? `- Meta description: ${pageHints.description}\n` : ""}${
        pageHints.headings && pageHints.headings.length
          ? `- Headings:\n${pageHints.headings.map((h) => `  - ${h}`).join("\n")}\n`
          : ""
      }`
    : "";

  const pastBlock = pastExperiments.length
    ? `\nPast experiments in this organization (most recent first):\n\`\`\`json\n${JSON.stringify(pastExperiments, null, 2)}\n\`\`\`\n`
    : "\n(No past experiments to ground suggestions in — generate sensible defaults.)\n";

  return `${currentBlock}${pageBlock}${pastBlock}
Return 3 to 4 short prompt suggestions following the rules.`;
}

export const postAISuggestions = createApiRequestHandler(validation)(async (
  req,
) => {
  const { visualChangesetId, pageHints } = req.body;
  const context = req.context;
  // Require PAT auth — AI calls count against per-org limits and we
  // want them attributable to specific users.
  requireUserAuth(context);

  const changeset = await findVisualChangesetById(
    visualChangesetId,
    req.organization.id,
  );
  if (!changeset)
    return context.throwNotFoundError("Visual changeset not found");

  const currentExperiment = await getExperimentById(
    context,
    changeset.experiment,
  );
  if (!currentExperiment)
    return context.throwNotFoundError("Experiment not found");

  // Suggestions are only useful to users who can actually act on them by
  // editing the variation, so we require the same permission as updating
  // the visual changeset itself. This also blocks read-only API keys from
  // burning LLM credits.
  if (!context.permissions.canUpdateVisualChange(currentExperiment)) {
    context.permissions.throwPermissionError();
  }

  if (await secondsUntilAICanBeUsedAgain(req.organization)) {
    throw new Error(
      "Daily AI usage limit reached. Try again later or upgrade your plan.",
    );
  }

  // Log the suggestion-generation inputs for debugging + iteration. No
  // user-typed prompt here — suggestions are generated from past
  // experiments + page hints — but the page hints can carry the page
  // URL/title which are useful context for diagnosing bad suggestions.
  logger.info(
    {
      orgId: req.organization.id,
      userId: context.userId,
      visualChangesetId,
      experimentId: currentExperiment.id,
      experimentName: currentExperiment.name,
      project: currentExperiment.project || null,
      pageHints: pageHints ?? null,
    },
    "[visual-editor-ai/suggestions] request",
  );

  // Past experiments — same project (if any), capped at 20 most recent.
  // We only include ones with at least a hypothesis or analysis since
  // empty rows add no signal but cost tokens.
  //
  // The Mongo `limit` is set well above the 20-row JS cap so the
  // hypothesis/description/analysis filter below still has headroom to
  // skip empty stubs and find 20 useful rows. Without this bound, large
  // organizations would pull every experiment in the project (or the
  // whole org when project is unset) on every side-panel open — each
  // doc can carry a large analysis blob, so it's a real memory + RTT
  // hit. 200 keeps the pull bounded without starving the filter.
  let pastExperiments: PastExperimentSummary[] = [];
  try {
    const all = await getAllExperiments(context, {
      project: currentExperiment.project,
      sortBy: { dateUpdated: -1 },
      limit: 200,
    });
    pastExperiments = all
      .filter((e) => e.id !== currentExperiment.id)
      .filter((e) => !!(e.hypothesis || e.description || e.analysis))
      .slice(0, 20)
      .map((e) => ({
        name: e.name,
        hypothesis: e.hypothesis || undefined,
        description: e.description || undefined,
        status: e.status,
        analysis: e.analysis || undefined,
      }));
  } catch (err) {
    // Non-fatal: if past-experiment query fails we fall through with no
    // grounding context and the AI uses sensible defaults.
    logger.warn(
      { err },
      "[visual-editor-ai/suggestions] past experiments query failed",
    );
  }

  const { visualEditorAIModel } = getAISettingsForOrg(context, true);

  const result = await parsePrompt({
    context,
    instructions,
    prompt: buildPrompt({
      currentExperiment: {
        name: currentExperiment.name,
        hypothesis: currentExperiment.hypothesis || undefined,
        description: currentExperiment.description || undefined,
      },
      pageHints,
      pastExperiments,
    }),
    temperature: 0.7,
    type: "visual-editor-ai-suggestions",
    isDefaultPrompt: true,
    zodObjectSchema: outputSchema,
    overrideModel: visualEditorAIModel,
  });

  return { suggestions: result.suggestions };
});
