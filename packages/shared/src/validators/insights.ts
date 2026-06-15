import { z } from "zod";
import { ownerField } from "./owner-field";

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
    // Provenance: whether this insight started life as an AI suggestion or
    // was written by hand. Immutable after creation (undefined only appears
    // on legacy docs and is normalized to "manual" by the model's migrate()).
    source: z.enum(["ai", "manual"]).optional(),
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
      "A paragraph or two of markdown describing the insight, the evidence across experiments, and a recommendation if applicable",
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
