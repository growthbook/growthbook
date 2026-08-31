import { VisualChangesetURLPattern } from "shared/types/visual-changeset";
import { postVisualChangesetsValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  createVisualChangeset,
  toVisualChangesetApiInterface,
} from "back-end/src/models/VisualChangesetModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const postVisualChangesets = createApiRequestHandler(
  postVisualChangesetsValidator,
)(async (req) => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    return req.context.throwNotFoundError("Could not find experiment");
  }

  if (experiment.type === "holdout") {
    throw new Error("Holdouts are not supported via this API");
  }

  if (!req.context.permissions.canUpdateVisualChange(experiment)) {
    req.context.permissions.throwPermissionError();
  }

  const urlPatterns: VisualChangesetURLPattern[] = req.body.urlPatterns.map(
    (p) => ({
      type: p.type,
      pattern: p.pattern,
      include: p.include ?? true,
    }),
  );

  const visualChangeset = await createVisualChangeset({
    experiment,
    urlPatterns,
    editorUrl: req.body.editorUrl,
    context: req.context,
  });

  return {
    visualChangeset: toVisualChangesetApiInterface(visualChangeset),
  };
});
