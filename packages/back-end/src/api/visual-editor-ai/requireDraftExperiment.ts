import type { AuditInterfaceInput } from "shared/types/audit";
import type { ExperimentInterface } from "shared/types/experiment";
import { getAffectedEnvsForExperiment } from "shared/util";
import type { ApiReqContext } from "back-end/types/api";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";

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
// canUpdateVisualChange, and audit the write: it reaches live traffic
// immediately.
export async function requireVisualChangeWrite(
  req: {
    context: ApiReqContext;
    audit: (data: AuditInterfaceInput) => Promise<void>;
  },
  experiment: ExperimentInterface,
  {
    allowRunning,
    visualChangesetId,
  }: { allowRunning: boolean; visualChangesetId: string },
): Promise<void> {
  requireDraftExperiment(req.context, experiment, { allowRunning });
  if (experiment.status !== "running") return;

  const linkedFeatures = await getFeaturesByIds(
    req.context,
    experiment.linkedFeatures || [],
  );
  const envs = getAffectedEnvsForExperiment({
    experiment,
    linkedFeatures,
    orgEnvironments: req.context.org.settings?.environments || [],
  });
  if (!req.context.permissions.canRunExperiment(experiment, envs)) {
    req.context.permissions.throwPermissionError();
  }
  await req.audit({
    event: "experiment.update",
    entity: { object: "experiment", id: experiment.id },
    details: JSON.stringify({ visualChangesetId, liveVisualChangeEdit: true }),
  });
}
