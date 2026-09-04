import type { Response } from "express";
import { ApiSetupRun } from "shared/validators";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getExperimentsByIds } from "back-end/src/models/ExperimentModel";

// Artifacts are pointers recorded at creation. An experiment recorded without a
// name carries its id as the label; show the experiment's current name instead.
async function withExperimentNames(
  context: Parameters<typeof getExperimentsByIds>[0],
  run: ApiSetupRun,
): Promise<ApiSetupRun> {
  const unnamed = run.artifacts.filter(
    (a) => a.kind === "experiment" && a.label === a.id,
  );
  if (!unnamed.length) return run;
  const experiments = await getExperimentsByIds(
    context,
    unnamed.map((a) => a.id),
  );
  const names = new Map(experiments.map((e) => [e.id, e.name]));
  return {
    ...run,
    artifacts: run.artifacts.map((a) => {
      const name =
        a.kind === "experiment" && a.label === a.id
          ? names.get(a.id)
          : undefined;
      return name ? { ...a, label: name } : a;
    }),
  };
}

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
    setupRun: await withExperimentNames(
      context,
      context.models.setupRuns.toApi(run),
    ),
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
    setupRuns: await Promise.all(
      runs
        .sort((a, b) => b.dateCreated.getTime() - a.dateCreated.getTime())
        .map((r) =>
          withExperimentNames(context, context.models.setupRuns.toApi(r)),
        ),
    ),
  });
};
