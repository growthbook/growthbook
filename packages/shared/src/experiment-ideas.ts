import type {
  ExperimentIdeaDerivedState,
  ExperimentIdeaSort,
} from "shared/validators";
import type {
  ExperimentIdeaStage,
  OrganizationSettings,
} from "shared/types/organization";
import { DEFAULT_EXPERIMENT_IDEA_STAGES } from "./constants";

export const RESERVED_EXPERIMENT_IDEA_STAGE_NAMES = [
  "converted",
  "testing",
  "tested",
  "learning available",
  "archived",
];

export function getExperimentIdeaStages(
  settings: Pick<
    OrganizationSettings,
    "experimentIdeaStages" | "defaultExperimentIdeaStage"
  > = {},
): { stages: ExperimentIdeaStage[]; defaultStageId: string } {
  const stages = settings.experimentIdeaStages?.length
    ? settings.experimentIdeaStages
    : DEFAULT_EXPERIMENT_IDEA_STAGES;
  const configuredDefault = settings.defaultExperimentIdeaStage;
  const defaultStageId =
    configuredDefault && stages.some((s) => s.id === configuredDefault)
      ? configuredDefault
      : stages[0].id;
  return { stages, defaultStageId };
}

// Returns an error message, or null when the configuration is valid.
export function validateExperimentIdeaStages(
  stages: ExperimentIdeaStage[],
  defaultStageId: string | undefined,
): string | null {
  if (!stages.length) return "At least one stage is required";
  const ids = new Set<string>();
  const labels = new Set<string>();
  for (const stage of stages) {
    const label = stage.label.trim().toLowerCase();
    if (!stage.id) return "Every stage needs an id";
    if (!label) return "Every stage needs a label";
    if (ids.has(stage.id)) return `Duplicate stage id "${stage.id}"`;
    if (labels.has(label)) return `Duplicate stage label "${stage.label}"`;
    if (
      RESERVED_EXPERIMENT_IDEA_STAGE_NAMES.includes(label) ||
      RESERVED_EXPERIMENT_IDEA_STAGE_NAMES.includes(stage.id.toLowerCase())
    ) {
      return `"${stage.label}" is reserved for a system-derived state`;
    }
    ids.add(stage.id);
    labels.add(label);
  }
  if (defaultStageId && !ids.has(defaultStageId)) {
    return "The default stage must be one of the configured stages";
  }
  return null;
}

// IDs removed from a stage list that are still referenced by ideas.
export function getRemovedStagesInUse(
  previous: ExperimentIdeaStage[],
  next: ExperimentIdeaStage[],
  stageIdsInUse: Iterable<string>,
): string[] {
  const nextIds = new Set(next.map((s) => s.id));
  const inUse = new Set(stageIdsInUse);
  return previous
    .map((s) => s.id)
    .filter((id) => !nextIds.has(id) && inUse.has(id));
}

export function deriveExperimentIdeaStates({
  experiments,
  hasLearning,
}: {
  experiments: { status: string; archived?: boolean }[];
  hasLearning: boolean;
}): ExperimentIdeaDerivedState[] {
  const states: ExperimentIdeaDerivedState[] = [];
  if (experiments.length > 0) states.push("converted");
  if (experiments.some((e) => e.status === "running")) states.push("testing");
  if (experiments.some((e) => e.status === "stopped")) states.push("tested");
  if (hasLearning) states.push("learning");
  return states;
}

type SortableIdea = {
  title: string;
  dateCreated: string | Date;
  dateUpdated: string | Date;
  upvoteCount: number;
};

function time(d: string | Date): number {
  return new Date(d).getTime();
}

// Ties break by recency so the order is stable and useful.
export function sortExperimentIdeas<T extends SortableIdea>(
  items: T[],
  sort: ExperimentIdeaSort,
): T[] {
  const byUpdated = (a: T, b: T) => time(b.dateUpdated) - time(a.dateUpdated);
  const compare: Record<ExperimentIdeaSort, (a: T, b: T) => number> = {
    updated: byUpdated,
    upvotes: (a, b) => b.upvoteCount - a.upvoteCount || byUpdated(a, b),
    newest: (a, b) =>
      time(b.dateCreated) - time(a.dateCreated) || byUpdated(a, b),
    oldest: (a, b) =>
      time(a.dateCreated) - time(b.dateCreated) || byUpdated(a, b),
    title: (a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) ||
      byUpdated(a, b),
  };
  return [...items].sort(compare[sort]);
}

// Keeps at least one stage visible: unchecking the last one is a no-op.
export function toggleVisibleStage(
  visible: string[],
  stageId: string,
): string[] {
  if (visible.includes(stageId)) {
    return visible.length > 1 ? visible.filter((s) => s !== stageId) : visible;
  }
  return [...visible, stageId];
}
