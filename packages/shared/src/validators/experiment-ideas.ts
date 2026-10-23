import { z } from "zod";
import { ownerField, ownerInputField } from "./owner-field";

export const experimentIdeaSourceValues = ["manual", "api", "agent"] as const;

export const experimentIdeaInformedByKinds = [
  "learning",
  "experiment",
] as const;

export const experimentIdeaInformedByValidator = z
  .object({
    kind: z.enum(experimentIdeaInformedByKinds),
    id: z.string(),
  })
  .strict();

export const experimentIdeaPowerCheckValidator = z
  .object({
    goalMetricId: z.string(),
    mde: z.number(),
    usersPerWeek: z.number(),
    variations: z.number(),
    computedAt: z.date(),
    computedBy: z.string(),
  })
  .strict();

export const experimentIdeaValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    // "" means organization-wide
    project: z.string(),

    title: z.string(),
    description: z.string(),
    hypothesis: z.string(),
    expectedOutcome: z.string(),
    rationale: z.string(),
    productArea: z.string(),

    owner: ownerField,
    createdBy: z.string(),
    authors: z.array(z.string()),
    tags: z.array(z.string()),
    metricIds: z.array(z.string()),
    goalMetricId: z.string(),

    analyticsDashboardId: z.string(),
    powerCheck: experimentIdeaPowerCheckValidator.nullable(),

    // ID of a stage from OrganizationSettings.experimentIdeaStages
    stage: z.string(),
    archived: z.boolean(),
    dateArchived: z.date().nullable(),
    archivedBy: z.string().nullable(),

    upvotes: z.array(z.string()),

    source: z.enum(experimentIdeaSourceValues),
    informedBy: z.array(experimentIdeaInformedByValidator),
    customFields: z.record(z.string(), z.unknown()),

    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

export type ExperimentIdeaInterface = z.infer<typeof experimentIdeaValidator>;
export type ExperimentIdeaInformedBy = z.infer<
  typeof experimentIdeaInformedByValidator
>;

const TITLE_MAX = 200;
const TEXT_MAX = 10000;

const trimmedTitle = z.string().trim().min(1).max(TITLE_MAX);
const longText = z.string().max(TEXT_MAX);

// Internal API request bodies. Explicit allowlists: createdBy, source,
// upvotes and archive state are server-controlled.
export const postExperimentIdeaBody = z
  .object({
    title: trimmedTitle,
    description: longText.optional(),
    hypothesis: longText.optional(),
    expectedOutcome: longText.optional(),
    rationale: longText.optional(),
    productArea: z.string().max(TITLE_MAX).optional(),
    project: z.string().optional(),
    stage: z.string().optional(),
    tags: z.array(z.string()).optional(),
    metricIds: z.array(z.string()).optional(),
    goalMetricId: z.string().optional(),
    analyticsDashboardId: z.string().optional(),
    informedBy: z.array(experimentIdeaInformedByValidator).optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const putExperimentIdeaBody = postExperimentIdeaBody
  .extend({
    title: trimmedTitle.optional(),
    owner: ownerInputField.optional(),
  })
  .strict();

export type PostExperimentIdeaBody = z.infer<typeof postExperimentIdeaBody>;
export type PutExperimentIdeaBody = z.infer<typeof putExperimentIdeaBody>;

export const experimentIdeaSortValues = [
  "updated",
  "upvotes",
  "newest",
  "oldest",
  "title",
] as const;
export type ExperimentIdeaSort = (typeof experimentIdeaSortValues)[number];

export const experimentIdeaDerivedStates = [
  "converted",
  "testing",
  "tested",
  "learning",
] as const;
export type ExperimentIdeaDerivedState =
  (typeof experimentIdeaDerivedStates)[number];

// JSON wire shapes
export type ExperimentIdeaStringDates = Omit<
  ExperimentIdeaInterface,
  | "dateCreated"
  | "dateUpdated"
  | "dateArchived"
  | "powerCheck"
  | "upvotes"
  | "organization"
> & {
  dateCreated: string;
  dateUpdated: string;
  dateArchived: string | null;
  powerCheck:
    | (Omit<z.infer<typeof experimentIdeaPowerCheckValidator>, "computedAt"> & {
        computedAt: string;
      })
    | null;
};

// List rows carry vote summaries; the voter list is detail-only.
export type ExperimentIdeaListItem = ExperimentIdeaStringDates & {
  upvoteCount: number;
  upvotedByMe: boolean;
  linkedExperimentCount: number;
  derivedStates: ExperimentIdeaDerivedState[];
  canManage: boolean;
};

export type ExperimentIdeaLinkedExperiment = {
  id: string;
  name: string;
  status: string;
  results?: string;
  dateCreated: string;
};

export type ExperimentIdeaLinkedLearning = {
  id: string;
  title: string;
  relation: "supporting" | "contradicting";
  experimentIds: string[];
};

export type ExperimentIdeaPriorWork = {
  kind: "learning" | "experiment";
  id: string;
  name: string;
  status?: string;
};

export type ExperimentIdeaDetail = ExperimentIdeaListItem & {
  upvotes: string[];
  linkedExperiments: ExperimentIdeaLinkedExperiment[];
  resultingLearnings: ExperimentIdeaLinkedLearning[];
  priorWork: ExperimentIdeaPriorWork[];
};
