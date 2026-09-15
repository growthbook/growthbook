import { z } from "zod";
import type { Changeset } from "shared/types/experiment";
import { findVisualChangesetById } from "back-end/src/models/VisualChangesetModel";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { validateExperimentChange } from "back-end/src/services/experimentChanges/changeExperimentStatus";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { requireUserAuth } from "./requireUserAuth";

// Renames only the display `name` — tracking key is intentionally left
// alone so SDK analytics don't silently break. Tracking-key edits go
// through the full GrowthBook web app.
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
  // Internal Visual Editor extension endpoint — not part of the
  // public OpenAPI spec.
  excludeFromSpec: true,
};

export const postRenameExperiment = createApiRequestHandler(validation)(async (
  req,
) => {
  const { visualChangesetId, name } = req.body;
  const context = req.context;
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

  // Rename lives on the experiment, not the changeset, so gate on
  // canUpdateExperiment (not canUpdateVisualChange).
  if (!context.permissions.canUpdateExperiment(experiment, {})) {
    context.permissions.throwPermissionError();
  }

  // Skip the write when unchanged to avoid spurious dateUpdated bumps
  // (which would invalidate SDK payload caches).
  const trimmed = name.trim();
  if (trimmed === experiment.name) {
    return { name: experiment.name };
  }

  const changes: Changeset = { name: trimmed };
  await validateExperimentChange({ context, experiment, changes });
  await updateExperiment({
    context,
    experiment,
    changes,
  });

  return { name: trimmed };
});
