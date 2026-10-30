import { ExperimentQualityCheckResult } from "shared/enterprise";

// Where the experiment page can take someone to fix a check
export interface QualityFixTargets {
  // Opens the Setup tab at an element id
  openSetup: (elementId: string) => void;
  openDetails: () => void;
  openHistory: () => void;
  editMetrics?: (() => void) | null;
  editResult?: (() => void) | null;
  recheckAI?: (() => void) | null;
}

export const HYPOTHESIS_ID = "experiment-hypothesis";
export const DESCRIPTION_ID = "experiment-description";

export type QualityFixAction = { label: string; onClick: () => void };

export function getQualityFixAction(
  check: Pick<ExperimentQualityCheckResult, "key" | "type" | "score">,
  targets: QualityFixTargets,
  // The Setup tab's implementation section
  implementationId: string,
): QualityFixAction | null {
  const action = (label: string, onClick?: (() => void) | null) =>
    onClick ? { label, onClick } : null;
  if (check.type === "ai" && check.score === null) {
    return action("Check again", targets.recheckAI);
  }
  switch (check.key) {
    case "hypothesis":
      return action("Add hypothesis", () => targets.openSetup(HYPOTHESIS_ID));
    case "ai-hypothesis-quality":
      return action("Edit hypothesis", () => targets.openSetup(HYPOTHESIS_ID));
    case "description":
      return action("Add description", () => targets.openSetup(DESCRIPTION_ID));
    case "screenshots":
    case "max-variations":
      return action("Edit variations", () =>
        targets.openSetup(implementationId),
      );
    case "goal-metrics":
    case "guardrail-metrics":
    case "ai-hypothesis-metric-alignment":
      return action("Edit metrics", targets.editMetrics);
    case "tags-or-project":
      return action("Edit tags", targets.openDetails);
    case "decision":
    case "analysis-written":
      return action("Edit result", targets.editResult);
    case "goal-metrics-locked":
    case "hypothesis-locked":
    case "stable-assignment":
    case "stable-analysis":
    case "clean-restarts":
      return action("View change", targets.openHistory);
    case "no-early-stop":
    case "planned-end":
      return null;
  }
  // Custom AI checks
  return null;
}

// The fix for a check, as listed under "fixes to reach"
export function describeQualityFix(check: ExperimentQualityCheckResult) {
  if (check.key.startsWith("custom:")) return `Meet “${check.label}”`;
  switch (check.key) {
    case "hypothesis":
      return "Add a hypothesis";
    case "description":
      return "Add a description";
    case "screenshots":
      return "Add screenshots of the variations";
    case "tags-or-project":
      return "Add tags or a Project";
    case "goal-metrics":
      return check.reason?.startsWith("No goal")
        ? "Add goal metrics"
        : `Cut goal metrics to ${(check.params?.maxGoalMetrics ?? 3) - 1}`;
    case "guardrail-metrics":
      return "Add guardrail metrics";
    case "max-variations":
      return "Use fewer variations";
    case "decision":
      return "Record a decision";
    case "analysis-written":
      return "Write up the analysis";
    case "ai-hypothesis-quality":
      return "Strengthen the hypothesis";
    case "ai-hypothesis-metric-alignment":
      return "Keep metrics the hypothesis predicts";
    // Not listed: how an experiment ran can't change afterwards
    case "goal-metrics-locked":
    case "hypothesis-locked":
    case "stable-assignment":
    case "stable-analysis":
    case "no-early-stop":
    case "clean-restarts":
    case "planned-end":
      return check.label;
  }
  return check.label;
}
