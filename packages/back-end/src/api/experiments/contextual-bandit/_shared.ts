import { Response } from "express";
import { getAffectedEnvsForExperiment } from "shared/util";
import { ExperimentInterface } from "shared/types/experiment";
import { ApiReqContext } from "back-end/types/api";
import { logger } from "back-end/src/util/logger";

export type CBPermissionAction = "read" | "run" | "delete";

/**
 * Emit a deprecation log line + RFC-8594-style Deprecation / Sunset / Link
 * response headers on every legacy `/api/v1/experiments/:id/contextual-bandit/*`
 * call. The new CB-native equivalents under `/api/v1/contextual-bandits/*`
 * (PR-4) cover the same shapes; this is the deprecation runway before the
 * legacy nested routes are deleted in PR-8's final cleanup commit.
 *
 * Sunset is unset deliberately — we'll backfill an exact date once the
 * deletion PR has a target version. Until then the Deprecation header is
 * enough for clients to surface a warning.
 */
export function markLegacyCBRouteDeprecated(
  res: Response,
  legacyPath: string,
  newPath: string,
): void {
  res.setHeader("Deprecation", "true");
  res.setHeader(
    "Link",
    `<${newPath}>; rel="successor-version"; type="application/json"`,
  );
  logger.warn(
    { legacyPath, newPath },
    "Deprecated CB endpoint called; use the CB-native /contextual-bandits surface instead",
  );
}

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
