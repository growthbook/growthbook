import { z } from "zod";
import { findVisualChangesetById } from "back-end/src/models/VisualChangesetModel";
import {
  getAllExperiments,
  getExperimentById,
} from "back-end/src/models/ExperimentModel";
import {
  parsePrompt,
  secondsUntilAICanBeUsedAgainForModel,
} from "back-end/src/enterprise/services/ai";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { logger } from "back-end/src/util/logger";
import { requireUserAuth } from "back-end/src/api/visual-editor-ai/requireUserAuth";

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
  // Internal Visual Editor extension endpoint — not part of the
  // public OpenAPI spec.
  excludeFromSpec: true,
};

// How many suggestions we hand back, and the longest one we'll keep.
// Enforced in code (see normalizeSuggestions) rather than in the schema.
const MIN_SUGGESTIONS = 3;
const MAX_SUGGESTIONS = 4;
const MAX_SUGGESTION_LENGTH = 140;

// No size constraints in the schema: Anthropic's output_format subset
// rejects minItems > 1, so count and length are enforced on the response.
// preprocess recovers the case where a model serializes the whole answer
// into `suggestions` as a JSON string; the emitted schema stays array-only.
const unwrapSerialized = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  try {
    const parsed = JSON.parse(v);
    if (Array.isArray(parsed)) return parsed;
    if (
      parsed &&
      Array.isArray((parsed as { suggestions?: unknown }).suggestions)
    ) {
      return (parsed as { suggestions: unknown }).suggestions;
    }
  } catch {
    // not JSON — let validation reject it
  }
  return v;
};

const outputSchema = z.object({
  suggestions: z
    .preprocess(unwrapSerialized, z.array(z.string()))
    .describe(
      "3 to 4 short, action-oriented test ideas for the current page. Each is a single imperative sentence under 14 words.",
    ),
});

// The model is prompted for 3-4 clean suggestions, but nothing enforces
// that at the protocol level now, so tidy the response before returning:
// trim, drop blanks, drop duplicates, truncate anything overlong, and cap
// the count. The MIN_SUGGESTIONS floor is applied by the caller, not here —
// this just reports what survived cleaning.
function normalizeSuggestions(suggestions: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of suggestions) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const capped =
      trimmed.length > MAX_SUGGESTION_LENGTH
        ? trimmed.slice(0, MAX_SUGGESTION_LENGTH).trimEnd()
        : trimmed;
    const key = capped.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(capped);
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

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

  // Plain list, not fenced JSON: models were mirroring the JSON back and
  // returning the whole answer as a serialized string in `suggestions`.
  const pastBlock = pastExperiments.length
    ? `\nPast experiments in this organization (most recent first):\n${pastExperiments
        .map((e) =>
          [
            `- Name: ${e.name}`,
            `  Status: ${e.status}`,
            e.hypothesis ? `  Hypothesis: ${e.hypothesis}` : "",
            e.description ? `  Description: ${e.description}` : "",
            e.analysis ? `  Analysis: ${e.analysis}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        )
        .join("\n")}\n`
    : "\n(No past experiments to ground suggestions in — generate sensible defaults.)\n";

  return `${currentBlock}${pageBlock}${pastBlock}
Return 3 to 4 short prompt suggestions following the rules.`;
}

export const postAISuggestions = createApiRequestHandler(validation)(async (
  req,
) => {
  const { visualChangesetId, pageHints } = req.body;
  const context = req.context;
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

  if (!context.permissions.canUpdateVisualChange(currentExperiment)) {
    context.permissions.throwPermissionError();
  }

  // Gated on the model this request will actually run: an org on its own key
  // for that provider pays its own bill, so the managed cap doesn't apply.
  const { visualEditorAIModel: cappedModel } =
    await getAISettingsForOrg(context);
  if (await secondsUntilAICanBeUsedAgainForModel(context, cappedModel)) {
    throw new Error(
      "Daily AI usage limit reached. Try again later or upgrade your plan.",
    );
  }

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

  // Past experiments capped at 20 useful rows (with hypothesis/description/
  // analysis). Mongo `limit: 200` gives the filter headroom to skip empty
  // stubs while bounding the pull for orgs with large analysis blobs.
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
    // Non-fatal: fall through with no grounding context.
    logger.warn(
      { err },
      "[visual-editor-ai/suggestions] past experiments query failed",
    );
  }

  const { visualEditorAIModel } = await getAISettingsForOrg(context, true);

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

  // All-or-nothing on the count. The old `.array(...).min(3)` schema gave us
  // a floor for free — a short response failed validation, burned the one
  // retry in parsePrompt, and then errored. We can't express that floor in
  // the schema any more (see outputSchema), so enforce it here instead.
  //
  // Returning 1-2 items would render a conspicuously thin suggestion list in
  // the side panel, so we'd rather hand back nothing: the extension already
  // treats an empty list as "no server suggestions" and falls back to its own
  // localized starter prompts, which reads as intentional. That also beats
  // re-erroring — same visible outcome for the user, no wasted retry tokens.
  const suggestions = normalizeSuggestions(result.suggestions);
  if (suggestions.length < MIN_SUGGESTIONS) {
    logger.warn(
      {
        orgId: req.organization.id,
        visualChangesetId,
        returned: result.suggestions.length,
        usable: suggestions.length,
      },
      "[visual-editor-ai/suggestions] too few usable suggestions; returning none",
    );
    return { suggestions: [] };
  }

  return { suggestions };
});
