import { z } from "zod";
import { apiBaseSchema } from "./base-model";
import { namedSchema } from "./openapi-helpers";
import { ownerEmailField, ownerField, ownerInputField } from "./owner-field";

// Provenance of a saved insight:
//  - "ai": surfaced by the AI insight finder and saved from the UI
//  - "manual": hand-written in the UI
//  - "api": created through the external REST API (e.g. by an agent)
// Immutable after creation.
export const insightSourceValues = ["ai", "manual", "api"] as const;

export const insightValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    owner: ownerField,
    // All users who have created or edited this insight. Owner first, then
    // subsequent editors in the order they first edited.
    authors: z.array(z.string()),
    title: z.string(),
    text: z.string(),
    tags: z.array(z.string()),
    supportingExperimentIds: z.array(z.string()),
    // Experiments whose outcomes seem to run counter to this insight. Can be
    // suggested by AI at generation time, surfaced by later contrary scans, or
    // curated manually by the team.
    contraryEvidence: z.array(z.string()),
    projects: z.array(z.string()).optional(),
    // ID of a learning status configured at the org level
    // (OrganizationSettings.learningStatuses). "" is the explicit
    // "no status" sentinel (undefined only appears on legacy docs and is
    // normalized to "" by the model's migrate()).
    status: z.string().optional(),
    // Provenance (see insightSourceValues). Immutable after creation
    // (undefined only appears on legacy docs and is normalized to "manual"
    // by the model's migrate()).
    source: z.enum(insightSourceValues).optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

export type InsightInterface = z.infer<typeof insightValidator>;

// JSON wire shape: Dates serialize to ISO strings. Use this on the
// front-end instead of re-declaring the interface by hand.
export type InsightInterfaceStringDates = Omit<
  InsightInterface,
  "dateCreated" | "dateUpdated"
> & {
  dateCreated: string;
  dateUpdated: string;
};

// List/detail API responses decorate each insight with whether the
// requesting user can edit or delete it (computed server-side from the
// model's permission logic).
export type InsightWithCanManage = InsightInterfaceStringDates & {
  canManage: boolean;
};

export const createInsightValidator = insightValidator.omit({
  id: true,
  organization: true,
  dateCreated: true,
  dateUpdated: true,
});

export const updateInsightValidator = z
  .object({
    title: z.string().optional(),
    text: z.string().optional(),
    tags: z.array(z.string()).optional(),
    supportingExperimentIds: z.array(z.string()).optional(),
    contraryEvidence: z.array(z.string()).optional(),
    projects: z.array(z.string()).optional(),
    status: z.string().optional(),
  })
  .strict();

// Shape returned by the AI when generating candidate insights for review
export const aiInsightSuggestionValidator = z.object({
  title: z
    .string()
    .describe("A short, descriptive title for the insight or learning"),
  text: z
    .string()
    .describe(
      "A paragraph or two of markdown describing the insight and the evidence across experiments, ending with a concrete, actionable recommendation for what to try or do next",
    ),
  confidence: z
    .enum(["low", "medium", "high"])
    .describe(
      "How strongly the provided experiments support this insight. 'high' = multiple experiments with large, statistically significant effects; 'low' = suggestive but limited or mixed evidence",
    ),
  tags: z
    .array(z.string())
    .describe(
      "A short list of 1-5 lowercase, hyphenated tags categorizing this insight (e.g. 'social-proof', 'urgency', 'mobile', 'pricing')",
    ),
  supportingExperimentIds: z
    .array(z.string())
    .describe(
      "List of experiment ids (from the input set) that support or evidence this insight",
    ),
  contraryExperimentIds: z
    .array(z.string())
    .describe(
      "List of experiment ids (from the input set) whose outcomes appear to run counter to this insight. Use [] when no contrary evidence exists in the input set.",
    ),
});

export const aiInsightSuggestionsResponseValidator = z.object({
  insights: z.array(aiInsightSuggestionValidator),
});

export type AiInsightSuggestion = z.infer<typeof aiInsightSuggestionValidator>;

// --- External REST API shapes ---

// API response shape (dates as ISO strings, resolved ownerEmail, no
// organization field). Appears as the "Insight" model in the API docs.
export const apiInsightValidator = namedSchema(
  "Insight",
  apiBaseSchema.safeExtend({
    owner: ownerField,
    ownerEmail: ownerEmailField,
    authors: z.array(z.string()),
    title: z.string(),
    text: z.string(),
    tags: z.array(z.string()),
    supportingExperimentIds: z.array(z.string()),
    contraryEvidence: z.array(z.string()),
    projects: z.array(z.string()),
    status: z.string(),
    source: z.enum(insightSourceValues),
  }),
);

export type ApiInsight = z.infer<typeof apiInsightValidator>;

export const apiCreateInsightBody = z.strictObject({
  title: z.string(),
  text: z.string().optional(),
  tags: z.array(z.string()).optional(),
  supportingExperimentIds: z.array(z.string()).optional(),
  contraryEvidence: z.array(z.string()).optional(),
  projects: z.array(z.string()).optional(),
  status: z
    .string()
    .optional()
    .describe(
      "ID of a learning status configured at the org level (Settings → General → Experiment Settings). Omit or pass an empty string for no status.",
    ),
  owner: ownerInputField.optional(),
});

// `source` is intentionally omitted — API-created insights are always "api".
export const apiUpdateInsightBody = apiCreateInsightBody
  .omit({ owner: true })
  .partial();

// Query params for GET /api/v1/insights
export const apiListInsightsQuery = z.strictObject({
  projectId: z.string().optional(),
  experimentId: z
    .string()
    .optional()
    .describe("Only return insights that reference this experiment"),
  tag: z.string().optional(),
  status: z.string().optional(),
});

// POST /api/v1/insights/search
export const apiSearchInsightsBody = z.strictObject({
  query: z.string().describe("Natural-language query to rank insights against"),
  limit: z.number().int().positive().max(50).optional(),
  projectId: z.string().optional(),
});

export const apiSearchInsightsResult = apiInsightValidator.safeExtend({
  similarity: z
    .number()
    .describe("Cosine similarity of the insight to the query (0-1)"),
});

export const apiSearchInsightsResponse = z.object({
  insights: z.array(apiSearchInsightsResult),
});

export type ApiSearchInsightResult = z.infer<typeof apiSearchInsightsResult>;
