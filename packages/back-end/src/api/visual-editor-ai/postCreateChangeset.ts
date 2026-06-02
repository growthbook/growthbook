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

// Creates an additional visual changeset on an EXISTING experiment, so a
// user can make a *different* set of DOM changes on a *different* URL
// within the same experiment (e.g. one changeset for /pricing and another
// for /checkout). The SDK applies, on any given page, whichever of the
// experiment's changesets has matching urlPatterns.
//
// The side panel's "same domain, different page" banner reaches this when
// the user chooses "Make different changes on this page" rather than
// widening the current changeset's URL targeting.
const bodySchema = z
  .object({
    // The changeset the user is currently editing — we derive the owning
    // experiment from it rather than trusting a raw experimentId from the
    // client (the user already has the changeset open, so they've passed
    // the read/permission gate on it).
    visualChangesetId: z.string(),
    // The active tab URL — becomes the new changeset's editorUrl (where to
    // navigate back to on resume).
    pageUrl: z.string().url(),
    // URL targeting for the new changeset. Defaults to the current exact
    // page on the client; bounded here the same way create-experiment is.
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
};

export const postCreateChangeset = createApiRequestHandler(validation)(async (
  req,
) => {
  const { visualChangesetId, pageUrl, urlPatterns } = req.body;
  const context = req.context;
  // Require PAT auth — creating a changeset is attributable, user-level
  // work, matching the rest of the visual-editor surface.
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

  // Gate on BOTH the experiment update (we flip hasVisualChangesets and
  // touch the experiment) and the visual-change create. canUpdateExperiment
  // only reads permission-relevant fields, so an empty second arg is fine
  // (matches postAddVariant).
  if (!context.permissions.canUpdateExperiment(experiment, {})) {
    context.permissions.throwPermissionError();
  }
  if (
    !context.permissions.canCreateVisualChange({ project: experiment.project })
  ) {
    context.permissions.throwPermissionError();
  }

  // Omitting `visualChanges` lets createVisualChangeset auto-generate one
  // empty entry per current variation via getLatestPhaseVariations —
  // matches the shape the side panel expects on load (and the create-
  // experiment path).
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
    // The side panel navigates the active tab to this URL (changeset id
    // appended) so the URL-watcher loads the new changeset on resume.
    editorRedirectUrl: appendChangesetParam(pageUrl, changeset.id),
  };
});

// Appends the changeset query param to a URL while preserving anything
// else the user already had on it. Mirrors postCreateExperiment — the side
// panel's parser supports both the new `gb-visual-editor-v2` param and the
// legacy `vc-id`; we emit the new one.
function appendChangesetParam(url: string, changesetId: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("gb-visual-editor-v2", changesetId);
    return u.toString();
  } catch {
    return url;
  }
}
