import type { Response } from "express";
import { ApiSetupRun } from "shared/validators";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";

export const getSetupRun = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<
    { status: 200; setupRun: ApiSetupRun } | { status: 404; message: string }
  >,
) => {
  const context = getContextFromReq(req);
  const run = await context.models.setupRuns.getById(req.params.id);

  if (!run) {
    res.status(404).json({ status: 404, message: "Setup Run not found" });
    return;
  }

  res.status(200).json({
    status: 200,
    setupRun: context.models.setupRuns.toApi(run),
  });
};

// Newest first, so "my last run" is the first match the caller finds.
export const getSetupRuns = async (
  req: AuthRequest,
  res: Response<{ status: 200; setupRuns: ApiSetupRun[] }>,
) => {
  const context = getContextFromReq(req);
  const runs = await context.models.setupRuns.getAll();

  res.status(200).json({
    status: 200,
    setupRuns: runs
      .sort((a, b) => b.dateCreated.getTime() - a.dateCreated.getTime())
      .map((r) => context.models.setupRuns.toApi(r)),
  });
};
