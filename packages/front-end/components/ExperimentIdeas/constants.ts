import {
  ExperimentIdeaDerivedState,
  ExperimentIdeaSort,
} from "shared/validators";
import { LearningStatusColor } from "shared/types/organization";

export const DERIVED_STATE_LABELS: Record<
  ExperimentIdeaDerivedState,
  { label: string; color: LearningStatusColor }
> = {
  converted: { label: "Converted", color: "violet" },
  testing: { label: "Testing", color: "blue" },
  tested: { label: "Tested", color: "green" },
  learning: { label: "Learning available", color: "amber" },
};

export const SORT_LABELS: Record<ExperimentIdeaSort, string> = {
  updated: "recently updated",
  upvotes: "most upvoted",
  newest: "newest",
  oldest: "oldest",
  title: "title A–Z",
};
