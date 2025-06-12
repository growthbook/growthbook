import type { Response } from "express";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ApiErrorResponse } from "back-end/types/api";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { getContextFromReq } from "back-end/src/services/organizations";

interface GetSnapshotsResponse {
  snapshots: Record<string, ExperimentSnapshotInterface>;
}

export async function getSnapshotsForDashboard(
  req: AuthRequest<never, { id: string }, never>,
  res: Response<GetSnapshotsResponse | ApiErrorResponse>
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const dashboard = await context.models.dashboards.getById(id);
  if (!dashboard) {
    return res.status(404).json({ message: "Not Found" });
  }
  // const uids = dashboard.blocks.map((b) => b.uid);
  return res.status(200).json({ snapshots: {} });
}
