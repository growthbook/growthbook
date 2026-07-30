import { z } from "zod";
import { apiBaseSchema } from "./base-model";
import { namedSchema } from "./openapi-helpers";
import { ownerEmailField, ownerField, ownerInputField } from "./owner-field";

// Provenance of a saved learning:
//  - "ai": surfaced by the AI learning finder and saved from the UI
//  - "manual": hand-written in the UI
//  - "api": created through the external REST API (e.g. by an agent)
// Immutable after creation.
export const learningSourceValues = ["ai", "manual", "api"] as const;

export const learningValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    owner: ownerField,
    // All users who have created or edited this learning. Owner first, then
    // subsequent editors in the order they first edited.
    authors: z.array(z.string()),
    title: z.string(),
    text: z.string(),
    tags: z.array(z.string()),
    supportingExperimentIds: z.array(z.string()),
    // Experiments whose outcomes run counter to this learning. Suggested by
    // AI at generation time or curated manually by the team.
    contradictingExperimentIds: z.array(z.string()),
    projects: z.array(z.string()),
    // ID of a learning status configured at the org level
    // (OrganizationSettings.learningStatuses). "" means no status.
    status: z.string(),
    // Provenance (see learningSourceValues). Immutable after creation.
    source: z.enum(learningSourceValues),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

export type LearningInterface = z.infer<typeof learningValidator>;

// JSON wire shape: Dates serialize to ISO strings. Use this on the
// front-end instead of re-declaring the interface by hand.
export type LearningInterfaceStringDates = Omit<
  LearningInterface,
  "dateCreated" | "dateUpdated"
> & {
  dateCreated: string;
  dateUpdated: string;
};

// List/detail API responses decorate each learning with whether the
// requesting user can edit or delete it (computed server-side from the
// model's permission logic).
export type LearningWithCanManage = LearningInterfaceStringDates & {
  canManage: boolean;
};

export const createLearningValidator = learningValidator.omit({
  id: true,
  organization: true,
  dateCreated: true,
  dateUpdated: true,
});

export const updateLearningValidator = z
  .object({
    title: z.string().optional(),
    text: z.string().optional(),
    tags: z.array(z.string()).optional(),
    supportingExperimentIds: z.array(z.string()).optional(),
    contradictingExperimentIds: z.array(z.string()).optional(),
    projects: z.array(z.string()).optional(),
    status: z.string().optional(),
  })
  .strict();

// Shape returned by the AI when generating candidate learnings for review
export const aiLearningSuggestionValidator = z.object({
  title: z
    .string()
    .describe("A short, descriptive title for the learning or learning"),
  text: z
    .string()
    .describe(
      "A paragraph or two of markdown describing the learning, the evidence across experiments, and a recommendation if applicable",
    ),
  tags: z
    .array(z.string())
    .describe(
      "A short list of 1-5 lowercase, hyphenated tags categorizing this learning (e.g. 'social-proof', 'urgency', 'mobile', 'pricing')",
    ),
  supportingExperimentIds: z
    .array(z.string())
    .describe(
      "List of experiment ids (from the input set) that support or evidence this learning",
    ),
  contradictingExperimentIds: z
    .array(z.string())
    .describe(
      "List of experiment ids (from the input set) whose outcomes appear to run counter to this learning. Use [] when no contrary evidence exists in the input set.",
    ),
});

export const aiLearningSuggestionsResponseValidator = z.object({
  learnings: z.array(aiLearningSuggestionValidator),
});

export type AiLearningSuggestion = z.infer<
  typeof aiLearningSuggestionValidator
>;

// --- External REST API shapes ---

// API response shape (dates as ISO strings, resolved ownerEmail, no
// organization field). Appears as the "Learning" model in the API docs.
export const apiLearningValidator = namedSchema(
  "Learning",
  apiBaseSchema.safeExtend({
    owner: ownerField,
    ownerEmail: ownerEmailField,
    authors: z.array(z.string()),
    title: z.string(),
    text: z.string(),
    tags: z.array(z.string()),
    supportingExperimentIds: z.array(z.string()),
    contradictingExperimentIds: z.array(z.string()),
    projects: z.array(z.string()),
    status: z.string(),
    source: z.enum(learningSourceValues),
  }),
);

export type ApiLearning = z.infer<typeof apiLearningValidator>;

export const apiCreateLearningBody = z.strictObject({
  title: z.string(),
  text: z.string().optional(),
  tags: z.array(z.string()).optional(),
  supportingExperimentIds: z.array(z.string()).optional(),
  contradictingExperimentIds: z.array(z.string()).optional(),
  projects: z.array(z.string()).optional(),
  status: z
    .string()
    .optional()
    .describe(
      "ID of a learning status configured at the org level (Settings → General → Experiment Settings). Omit or pass an empty string for no status.",
    ),
  owner: ownerInputField.optional(),
});

// `source` is intentionally omitted — API-created learnings are always "api".
export const apiUpdateLearningBody = apiCreateLearningBody
  .omit({ owner: true })
  .partial();

// Query params for GET /api/v1/learnings
export const apiListLearningsQuery = z.strictObject({
  projectId: z.string().optional(),
  experimentId: z
    .string()
    .optional()
    .describe("Only return learnings that reference this experiment"),
  tag: z.string().optional(),
  status: z.string().optional(),
});

// POST /api/v1/learnings/search
export const apiSearchLearningsBody = z.strictObject({
  query: z
    .string()
    .describe("Natural-language query to rank learnings against"),
  limit: z.number().int().positive().max(50).optional(),
  projectId: z.string().optional(),
});

export const apiSearchLearningsResult = apiLearningValidator.safeExtend({
  similarity: z
    .number()
    .describe("Cosine similarity of the learning to the query (0-1)"),
});

export const apiSearchLearningsResponse = z.object({
  learnings: z.array(apiSearchLearningsResult),
});

export type ApiSearchLearningResult = z.infer<typeof apiSearchLearningsResult>;
