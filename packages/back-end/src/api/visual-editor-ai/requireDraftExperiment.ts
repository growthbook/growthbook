import type { AuditInterfaceInput } from "shared/types/audit";
import type { ExperimentInterface } from "shared/types/experiment";
import type { ApiReqContext } from "back-end/types/api";
import {
  assertCanRunLinkedChanges,
  auditVisualChangeEditAfterStart,
} from "back-end/src/services/experiments";

// Drafts only, so a stale panel can't clobber a live test; `allowRunning` admits running.
export function requireDraftExperiment(
  context: ApiReqContext,
  experiment: { status: string; archived: boolean },
  { allowRunning = false }: { allowRunning?: boolean } = {},
): void {
  if (allowRunning && !experiment.archived && experiment.status === "running") {
    return;
  }
  if (experiment.archived || experiment.status !== "draft") {
    context.throwBadRequestError(
      `Only draft experiments can have their visual changes edited (this experiment is ${
        experiment.archived ? "archived" : experiment.status
      }). Set it back to draft in GrowthBook to make changes.`,
    );
  }
}

// Mirror the app's bar for edits after start (runExperiments). Returns the audit step, to run once the write succeeds.
export function requireVisualChangeWrite(
  req: {
    context: ApiReqContext;
    audit: (data: AuditInterfaceInput) => Promise<void>;
  },
  experiment: ExperimentInterface,
  {
    allowRunning,
    visualChangesetId,
  }: { allowRunning: boolean; visualChangesetId: string },
): () => Promise<void> {
  // A stopped experiment is open like a draft; running still needs the opt-in.
  if (experiment.archived || experiment.status !== "stopped") {
    requireDraftExperiment(req.context, experiment, { allowRunning });
  }
  if (experiment.status === "draft") return async () => {};

  assertCanRunLinkedChanges(req.context, experiment);
  return () =>
    auditVisualChangeEditAfterStart(req.audit, experiment, visualChangesetId);
}
