import type { Response } from "express";
import { hasSuperAdminPermission } from "shared/permissions";
import type { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  backfillAutoExperimentSettings,
  countAutoExperimentBackfillPending,
} from "back-end/src/services/autoExperimentsBackfill";

// One pass stays well inside a request timeout; the page calls again until
// nothing is left.
const PASS_MS = 15_000;

export async function getBackfill(req: AuthRequest, res: Response) {
  if (!hasSuperAdminPermission(req.superAdmin, "view")) {
    return res.status(403).json({
      status: 403,
      message: "This action requires the view super admin permission",
    });
  }
  res.status(200).json({
    status: 200,
    remaining: await countAutoExperimentBackfillPending(),
  });
}

export async function postBackfill(req: AuthRequest, res: Response) {
  // Writes to every organization, so a scoped super admin isn't enough.
  if (req.superAdmin !== true) {
    return res.status(403).json({
      status: 403,
      message: "This action requires a full super admin",
    });
  }
  res.status(200).json({
    status: 200,
    ...(await backfillAutoExperimentSettings({ maxMs: PASS_MS })),
  });
}
