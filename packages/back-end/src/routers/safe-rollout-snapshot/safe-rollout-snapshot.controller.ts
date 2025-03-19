import type { Response } from "express";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { SafeRolloutSnapshotInterface } from "back-end/src/validators/safe-rollout";
import { createSafeRolloutSnapshot } from "back-end/src/services/safeRolloutSnapshots";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { SafeRolloutRule } from "back-end/src/validators/features";

// region GET /safeRollout/:id/snapshot
/**
 * GET /safeRollout/:id/snapshot
 * Create a Template resource
 * @param req
 * @param res
 */
export const getLatestSnapshot = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200; snapshot: SafeRolloutSnapshotInterface }>
) => {
  const context = getContextFromReq(req);

  const snapshot = await context.models.safeRolloutSnapshots.getLatestSnapshot({
    safeRollout: req.params.id,
  });

  res.status(200).json({
    status: 200,
    snapshot,
  });
};

// endregion GET /safeRollout/:id/snapshot

// region POST /safeRollout/snapshot
/**
 * POST /safeRollout/snapshot
 * Create a Snapshot resource
 * @param req
 * @param res
 */
export const createSnapshot = async (
  req: AuthRequest<SafeRolloutRule>,
  res: Response<{ status: 200; snapshot: SafeRolloutSnapshotInterface }>
) => {
  const context = getContextFromReq(req);
  const safeRollout = req.body;

  const { snapshot, queryRunner } = await createSafeRolloutSnapshot({
    context,
    safeRollout,
    dimension: "",
    useCache: true,
  });

  res.status(200).json({
    status: 200,
    snapshot,
  });
};
// endregion POST /safeRollout/snapshot
