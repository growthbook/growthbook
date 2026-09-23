import type { AuditInterfaceInput } from "shared/types/audit";
import type { ExperimentInterface } from "shared/types/experiment";
import { getAffectedEnvsForExperiment } from "shared/util";
import type { ApiReqContext } from "back-end/types/api";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { logger } from "back-end/src/util/logger";
import { getEnvironments } from "back-end/src/util/organization.util";

// The visual editor edits DRAFT experiments. Once an experiment is running
// or stopped (or archived), its variations, traffic split, and analysis are
// live or finalized — structural edits (add / rename / delete variant, etc.)
// must go through the full GrowthBook app instead. Reject anything else with
// a 400 so a stale side panel can't clobber a live test. `allowRunning` is
// the one deliberate exception, for callers that confirmed with the user;
// stopped and archived never pass.
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

// Gate for writing visual changes. Editing a running experiment is the
// GrowthBook app's own policy — anyone with runExperiments on the affected
// environments can do it there — so mirror that bar rather than the weaker
// canUpdateVisualChange. Returns the audit step for the caller to run once
// its write has succeeded: the record says a live edit happened, so it must
// not precede a write that fails. A no-op for draft experiments.
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
  requireDraftExperiment(req.context, experiment, { allowRunning });
  if (experiment.status !== "running") return async () => {};

  // A visual change is served in every environment the experiment runs in,
  // however its linked features are scoped. Deriving the environments from
  // those features would shrink the check whenever the stored
  // hasVisualChangesets flag is stale: unreadable features are filtered out
  // and an empty list passes vacuously. Ask for all of them instead, as the
  // app does for any experiment with visual changes.
  const envs = getAffectedEnvsForExperiment({
    experiment: { ...experiment, hasVisualChangesets: true },
    // The SDK's default environments when none are configured; an empty list
    // would pass the check vacuously.
    orgEnvironments: getEnvironments(req.context.org),
  });
  if (!req.context.permissions.canRunExperiment(experiment, envs)) {
    req.context.permissions.throwPermissionError();
  }
  // The write already landed, so a failed audit is logged, not surfaced.
  return () =>
    req
      .audit({
        event: "experiment.update",
        entity: { object: "experiment", id: experiment.id },
        details: auditDetailsUpdate(experiment, experiment, {
          visualChangesetId,
          liveVisualChangeEdit: true,
        }),
      })
      .catch((err) =>
        logger.error(
          { err, experimentId: experiment.id, visualChangesetId },
          "Failed to audit a live visual change edit",
        ),
      );
}
