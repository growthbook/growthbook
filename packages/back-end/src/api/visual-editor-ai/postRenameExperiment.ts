import { z } from "zod";
import { findVisualChangesetById } from "back-end/src/models/VisualChangesetModel";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { requireUserAuth } from "./requireUserAuth";

// Rename the experiment associated with a visual changeset. This deliberately
// only touches the display `name` field — the tracking key, variations, URL
// targeting, etc. are left untouched. The tracking key is what the SDK
// emits in events, so changing the experiment's friendly name from inside
// the side panel must NOT silently rotate the SDK identifier and break
// existing analytics. Callers wanting to rename the tracking key go through
// the full GrowthBook web app, which surfaces the consequences.
const bodySchema = z
  .object({
    visualChangesetId: z.string(),
    name: z.string().min(1).max(200),
  })
  .strict();

const validation = {
  bodySchema,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.any(),
  method: "post" as const,
  path: "/visual-editor/rename-experiment",
  operationId: "postVisualEditorRenameExperiment",
};

export const postRenameExperiment = createApiRequestHandler(validation)(async (
  req,
) => {
  const { visualChangesetId, name } = req.body;
  const context = req.context;
  // Require PAT auth — mutates the experiment; we want the change
  // attributable to a real user (matches every other visual-editor
  // write).
  requireUserAuth(context);

  const changeset = await findVisualChangesetById(
    visualChangesetId,
    req.organization.id,
  );
  if (!changeset) {
    return context.throwNotFoundError("Visual changeset not found");
  }

  const experiment = await getExperimentById(context, changeset.experiment);
  if (!experiment) {
    return context.throwNotFoundError("Experiment not found");
  }

  // Gate on the experiment-update permission. We don't use
  // canUpdateVisualChange here because the change is at the experiment
  // level (the name field lives on the experiment, not on the visual
  // changeset). The second arg only carries permission-relevant deltas
  // (project moves etc.) — a rename doesn't change scope, so `{}` is
  // correct and matches the pattern used by postAddVariant.
  if (!context.permissions.canUpdateExperiment(experiment, {})) {
    context.permissions.throwPermissionError();
  }

  // No-op when the name is unchanged. Cheaper for the caller (no audit
  // log entry) and avoids spurious dateUpdated bumps that would invalidate
  // SDK payload caches downstream.
  const trimmed = name.trim();
  if (trimmed === experiment.name) {
    return { name: experiment.name };
  }

  await updateExperiment({
    context,
    experiment,
    changes: { name: trimmed },
  });

  return { name: trimmed };
});
