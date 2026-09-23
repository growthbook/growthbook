import type { AuditInterfaceInput } from "shared/types/audit";
import type { ExperimentInterface } from "shared/types/experiment";
import { getAffectedEnvsForExperiment } from "shared/util";
import type { ApiReqContext } from "back-end/types/api";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { logger } from "back-end/src/util/logger";
import { getEnvironments } from "back-end/src/util/organization.util";

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

// Mirror the app's bar for live edits (runExperiments). Returns the audit step, to run once the write succeeds.
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

  // Every environment, not the linked features' ones: a stale hasVisualChangesets flag would shrink the check.
  const envs = getAffectedEnvsForExperiment({
    experiment: { ...experiment, hasVisualChangesets: true },
    // getEnvironments falls back to the SDK defaults; an empty list would pass vacuously.
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
