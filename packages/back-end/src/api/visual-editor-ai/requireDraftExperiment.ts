import type { ApiReqContext } from "back-end/types/api";

// The visual editor only edits DRAFT experiments. Once an experiment is
// running or stopped (or archived), its variations, traffic split, and
// analysis are live or finalized — structural edits (add / rename / delete
// variant, etc.) must go through the full GrowthBook app instead. Reject
// anything else with a 400 so a stale side panel can't clobber a live test.
export function requireDraftExperiment(
  context: ApiReqContext,
  experiment: { status: string; archived: boolean },
): void {
  if (experiment.archived || experiment.status !== "draft") {
    context.throwBadRequestError(
      `Only draft experiments can have their visual changes edited (this experiment is ${
        experiment.archived ? "archived" : experiment.status
      }). Set it back to draft in GrowthBook to make changes.`,
    );
  }
}
