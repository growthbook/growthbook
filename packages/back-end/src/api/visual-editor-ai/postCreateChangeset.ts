import { z } from "zod";
import {
  createVisualChangeset,
  findVisualChangesetById,
  toVisualChangesetApiInterface,
} from "back-end/src/models/VisualChangesetModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { logger } from "back-end/src/util/logger";
import { requireUserAuth } from "./requireUserAuth";

// Creates an additional visual changeset on an existing experiment so a
// user can make different DOM changes on a different URL within the same
// experiment. The SDK applies whichever changeset has matching urlPatterns
// on the current page.
const bodySchema = z
  .object({
    // The changeset the user is currently editing — we derive the owning
    // experiment from it rather than trusting a raw experimentId.
    visualChangesetId: z.string(),
    pageUrl: z.string().url(),
    urlPatterns: z
      .array(
        z.object({
          include: z.boolean().default(true),
          type: z.enum(["simple", "regex"]).default("simple"),
          pattern: z.string().min(1).max(2000),
        }),
      )
      .min(1)
      .max(100),
  })
  .strict();

const validation = {
  bodySchema,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.any(),
  method: "post" as const,
  path: "/visual-editor/create-changeset",
  operationId: "postVisualEditorCreateChangeset",
  // Internal Visual Editor extension endpoint — not part of the
  // public OpenAPI spec.
  excludeFromSpec: true,
};

export const postCreateChangeset = createApiRequestHandler(validation)(async (
  req,
) => {
  const { visualChangesetId, pageUrl, urlPatterns } = req.body;
  const context = req.context;
  requireUserAuth(context);

  const sourceChangeset = await findVisualChangesetById(
    visualChangesetId,
    req.organization.id,
  );
  if (!sourceChangeset) {
    return context.throwNotFoundError("Visual changeset not found");
  }

  const experiment = await getExperimentById(
    context,
    sourceChangeset.experiment,
  );
  if (!experiment) return context.throwNotFoundError("Experiment not found");

  // Gate on both the experiment update (we flip hasVisualChangesets) and
  // the visual-change create.
  if (!context.permissions.canUpdateExperiment(experiment, {})) {
    context.permissions.throwPermissionError();
  }
  if (
    !context.permissions.canCreateVisualChange({ project: experiment.project })
  ) {
    context.permissions.throwPermissionError();
  }

  // Omit `visualChanges` so createVisualChangeset auto-generates one empty
  // entry per current variation.
  const changeset = await createVisualChangeset({
    experiment,
    context,
    urlPatterns,
    editorUrl: pageUrl,
  });

  logger.info(
    {
      experimentId: experiment.id,
      sourceChangesetId: visualChangesetId,
      newChangesetId: changeset.id,
      orgId: context.org.id,
      userId: context.userId,
    },
    "[visual-editor-ai] changeset created on existing experiment",
  );

  return {
    visualChangeset: toVisualChangesetApiInterface(changeset),
    // The side panel navigates the active tab to this URL so the URL
    // watcher loads the new changeset on resume.
    editorRedirectUrl: appendChangesetParam(pageUrl, changeset.id),
  };
});

// Side panel parser supports both `gb-visual-editor-v2` (new) and `vc-id`
// (legacy); we emit the new one.
function appendChangesetParam(url: string, changesetId: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("gb-visual-editor-v2", changesetId);
    return u.toString();
  } catch {
    return url;
  }
}
