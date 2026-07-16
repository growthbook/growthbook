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

const bodySchema = z
  .object({
    visualChangesetId: z.string(),
    // Internal variation `id` — matches experiment.variations[].id and
    // visualChange.variation.
    variationId: z.string(),
    name: z.string().min(1).max(120),
  })
  .strict();

const validation = {
  bodySchema,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.any(),
  method: "post" as const,
  path: "/visual-editor/rename-variant",
  operationId: "postVisualEditorRenameVariant",
  // Internal Visual Editor extension endpoint — not part of the
  // public OpenAPI spec.
  excludeFromSpec: true,
};

// Renames a single variation's display name. The editor sources the variant
// name from experiment.variations[].name, so that's the source of truth we
// update — the variation key/id is left untouched so SDK bucketing and
// analytics stay stable.
export const postRenameVariant = createApiRequestHandler(validation)(async (
  req,
) => {
  const { visualChangesetId, variationId, name } = req.body;
  const context = req.context;
  requireUserAuth(context);

  const changeset = await findVisualChangesetById(
    visualChangesetId,
    req.organization.id,
  );
  if (!changeset)
    return context.throwNotFoundError("Visual changeset not found");

  const experiment = await getExperimentById(context, changeset.experiment);
  if (!experiment) return context.throwNotFoundError("Experiment not found");

  // Rename lives on the experiment, not the changeset — gate accordingly.
  if (!context.permissions.canUpdateExperiment(experiment, {})) {
    context.permissions.throwPermissionError();
  }

  const idx = experiment.variations.findIndex((v) => v.id === variationId);
  if (idx < 0) {
    return context.throwBadRequestError(
      "Variation not found in this experiment",
    );
  }

  // Skip a no-op write to avoid a spurious dateUpdated bump (which would
  // invalidate SDK payload caches).
  const trimmed = name.trim();
  if (trimmed === experiment.variations[idx].name) {
    return { name: trimmed };
  }

  const nextVariations = experiment.variations.map((v, i) =>
    i === idx ? { ...v, name: trimmed } : v,
  );
  const changes: Changeset = { variations: nextVariations };
  await validateExperimentChange({ context, experiment, changes });
  await updateExperiment({ context, experiment, changes });

  return { name: trimmed };
});
