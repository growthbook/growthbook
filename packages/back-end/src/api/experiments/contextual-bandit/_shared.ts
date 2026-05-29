import { getAffectedEnvsForExperiment } from "shared/util";
import { ExperimentInterface } from "shared/types/experiment";
import { ApiReqContext } from "back-end/types/api";

export type CBPermissionAction = "read" | "run" | "delete";

/**
 * Permission gate for external Contextual Bandit endpoints.
 *
 * The CB models themselves now delegate RBAC to the parent experiment, but
 * external handlers reach into the models with `bypassReadPermissionChecks`
 * paths (e.g. `getBySnapshotIdInOrg` returns the doc before any per-doc
 * filter), so we add an explicit gate here that matches the same
 * parent-experiment permission as the model.
 */
export function requireCBPermission(
  context: ApiReqContext,
  experiment: ExperimentInterface,
  action: CBPermissionAction,
): void {
  if (!checkCBPermission(context, experiment, action)) {
    context.permissions.throwPermissionError();
  }
}

export function checkCBPermission(
  context: ApiReqContext,
  experiment: ExperimentInterface,
  action: CBPermissionAction,
): boolean {
  if (action === "read") {
    return context.permissions.canReadSingleProjectResource(experiment.project);
  }
  if (action === "delete") {
    return context.permissions.canDeleteExperiment(experiment);
  }
  // "run" — refresh / weight updates count as running the experiment.
  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
  });
  return context.permissions.canRunExperiment(experiment, envs);
}
