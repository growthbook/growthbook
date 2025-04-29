import type { Response } from "express";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { SafeRolloutSnapshotInterface } from "back-end/src/validators/safe-rollout-snapshot";
import { createSafeRolloutSnapshot } from "back-end/src/services/safeRolloutSnapshots";
import { getIntegrationFromDatasourceId } from "back-end/src/services/datasource";
import { SafeRolloutResultsQueryRunner } from "back-end/src/queryRunners/SafeRolloutResultsQueryRunner";
import { getFeature } from "back-end/src/models/FeatureModel";
import { SNAPSHOT_TIMEOUT } from "back-end/src/controllers/experiments";

// region GET /safe-rollout/:id/snapshot
/**
 * GET /safe-rollout/:id/snapshot
 * Get the latest snapshot and the latest snapshot with results for a safe rollout
 * @param req
 * @param res
 */
export const getLatestSafeRolloutSnapshot = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{
    status: 200;
    snapshot?: SafeRolloutSnapshotInterface;
    latest?: SafeRolloutSnapshotInterface;
  }>
) => {
  const context = getContextFromReq(req);

  const snapshot = await context.models.safeRolloutSnapshots.getSnapshotForSafeRollout(
    {
      safeRolloutId: req.params.id,
    }
  );

  const latest = await context.models.safeRolloutSnapshots.getSnapshotForSafeRollout(
    {
      safeRolloutId: req.params.id,
      withResults: false,
    }
  );

  res.status(200).json({
    status: 200,
    snapshot,
    latest,
  });
};

// endregion GET /safeRollout/:id/snapshot

// region POST /safe-rollout/:id/snapshot
/**
 * POST /safe-rollout/:id/snapshot
 * Create a Snapshot resource
 * @param req
 * @param res
 */
export const postSafeRolloutSnapshot = async (
  req: AuthRequest<never, { id: string }, { force?: string }>,
  res: Response<{
    status: 200 | 404;
    snapshot?: SafeRolloutSnapshotInterface;
    message?: string;
  }>
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const useCache = !req.query["force"];

  // This is doing an expensive analytics SQL query, so may take a long time
  // Set timeout to 30 minutes
  req.setTimeout(SNAPSHOT_TIMEOUT);
  const safeRollout = await context.models.safeRollout.getById(id);
  if (!safeRollout) {
    return res.status(404).json({
      status: 404,
      message: "Safe Rollout not found",
    });
  }
  const { snapshot } = await createSafeRolloutSnapshot({
    context,
    useCache,
    safeRollout,
  });

  res.status(200).json({
    status: 200,
    snapshot,
  });
};
// endregion POST /safe-rollout/:id/snapshot

// region POST /safe-rollout/snapshot/:id/cancel
/**
 * POST /safe-rollout/snapshot/:id/cancel
 * Cancel a Snapshot
 * @param req
 * @param res
 */
export const cancelSafeRolloutSnapshot = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 | 400 | 404; message?: string }>
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const snapshot = await context.models.safeRolloutSnapshots.getById(id);
  if (!snapshot) {
    return res.status(400).json({
      status: 400,
      message: "No snapshot found with that id",
    });
  }

  const safeRollout = await context.models.safeRollout.getById(
    snapshot.safeRolloutId
  );
  if (!safeRollout) {
    return res.status(404).json({
      status: 404,
      message: "Safe Rollout not found",
    });
  }

  const feature = await getFeature(context, safeRollout.featureId);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  const integration = await getIntegrationFromDatasourceId(
    context,
    snapshot.settings.datasourceId
  );

  const queryRunner = new SafeRolloutResultsQueryRunner(
    context,
    snapshot,
    integration
  );
  await queryRunner.cancelQueries();
  await context.models.safeRolloutSnapshots.deleteById(snapshot.id);

  res.status(200).json({ status: 200 });
};
// endregion POST /safe-rollout/snapshot/:id/cancel

// region PUT /safe-rollout/:id/status
/**
 * PUT /safe-rollout/:id/status
 * Update the status of a safe rollout rule (rolled back, released, etc)
 * @param req
 * @param res
 */
export async function putSafeRolloutStatus(
  req: AuthRequest<{ status: "released" | "rolled-back" }, { id: string }>,
  res: Response<{ status: 200 }>
) {
  const { id } = req.params;
  const { status } = req.body;
  const context = getContextFromReq(req);
  const safeRollout = await context.models.safeRollout.getById(id);
  if (!safeRollout) {
    throw new Error("Could not find safe rollout");
  }

  await context.models.safeRollout.update(safeRollout, {
    status,
  });

  res.status(200).json({
    status: 200,
  });
}
// endregion PUT /safe-rollout/:id/status
