import { z } from "zod";
import uniqid from "uniqid";
import { v4 as uuidv4 } from "uuid";
import type {
  ExperimentInterface,
  ExperimentInterfaceExcludingHoldouts,
} from "shared/validators";
import { createExperiment } from "back-end/src/models/ExperimentModel";
import {
  createVisualChangeset,
  toVisualChangesetApiInterface,
} from "back-end/src/models/VisualChangesetModel";
import { toExperimentApiInterface } from "back-end/src/services/experiments";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { logger } from "back-end/src/util/logger";
import { requireUserAuth } from "./requireUserAuth";

// The extension's create-experiment flow is intentionally minimal: name +
// URL targeting + optional project. Everything else (datasource, metrics,
// hypothesis text, weighting, advanced targeting rules) is left to be
// edited in the GrowthBook web app afterwards. The endpoint just gets
// the user into the editor with a real experiment + changeset attached.
const bodySchema = z
  .object({
    name: z.string().min(1).max(200),
    // `pageUrl` is the active tab's URL at create time — used as the
    // editorUrl for the visual changeset (where to navigate back to when
    // resuming the experiment) and also to derive the default URL pattern
    // if the caller hasn't passed one explicitly.
    pageUrl: z.string().url(),
    // The URL the experiment will run on in production. We accept either
    // a simple pattern (string + type) or a full pattern object. The
    // array is capped (and each pattern bounded) because the whole list
    // is persisted on the experiment and re-evaluated by the SDK on every
    // page load — there's no real-world targeting need for more than a
    // handful, so the cap exists purely to reject pathological input.
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
    project: z.string().optional(),
    // The targeting attribute used to bucket users into variations. The
    // side panel is expected to surface the org's hashable attributes
    // from /visual-editor/bootstrap and pass an explicit value here —
    // we deliberately don't have a server-side default, because guessing
    // "id" would silently mis-bucket orgs whose primary identifier is
    // something else (device_id, anonymous_id, user_uuid, etc.). Range
    // matches the typical attribute property name length.
    hashAttribute: z.string().min(1).max(100),
    // Optional richer fields the user can prefill if they want — purely
    // pass-through to createExperiment.
    hypothesis: z.string().max(2000).optional(),
    description: z.string().max(2000).optional(),
  })
  .strict();

const validation = {
  bodySchema,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.any(),
  method: "post" as const,
  path: "/visual-editor/create-experiment",
  operationId: "postVisualEditorCreateExperiment",
};

export const postCreateExperiment = createApiRequestHandler(validation)(async (
  req,
) => {
  const {
    name,
    pageUrl,
    urlPatterns,
    project,
    hashAttribute,
    hypothesis,
    description,
  } = req.body;
  const context = req.context;

  // Identity check: the experiment needs an owner, and per-user
  // permissions / audit attribution need a user. See requireUserAuth
  // for the full rationale.
  requireUserAuth(context);

  // Permission: creating an experiment is the gate. We require BOTH
  // canCreateExperiment (the experiment itself) and canCreateVisualChange
  // (the visual changeset we attach) so a user who only has one of the
  // two permissions can't sneak through. Both are checked here, BEFORE
  // any write — canCreateVisualChange only depends on the project, which
  // we already have. Checking it up front avoids the orphaned-experiment
  // failure mode where the experiment is created and then the changeset
  // permission check fails, leaving a half-built experiment with no
  // changeset behind.
  if (!context.permissions.canCreateExperiment({ project })) {
    context.permissions.throwPermissionError();
  }
  if (!context.permissions.canCreateVisualChange({ project })) {
    context.permissions.throwPermissionError();
  }

  // Build the experiment shell. Status "draft" so it doesn't fire on
  // anyone until the user finishes setup in GrowthBook. Two-variant
  // (Control + Variant 1) is the right default for a visual experiment;
  // they can add more variants from the side panel later via add-variant.
  const controlId = uniqid("var_");
  const variantId = uniqid("var_");
  const experimentToCreate: Partial<ExperimentInterface> = {
    name,
    status: "draft",
    // Caller picks the hash attribute (the side panel surfaces the org's
    // configured hashable attributes via /visual-editor/bootstrap). No
    // server-side fallback — hardcoding "id" silently mis-buckets orgs
    // whose primary identifier is something else.
    hashAttribute,
    trackingKey: "", // createExperiment auto-generates one
    description: description || "",
    hypothesis: hypothesis || "",
    project,
    // Attribute the experiment to the authenticated user. context.userId
    // is guaranteed non-empty by the guard above; createExperiment
    // doesn't fill this in automatically (unlike some other models that
    // fall back to context.userId on missing input), so the visual-editor
    // path has to set it explicitly. Mirrors the internal experiments
    // controller's pattern (`owner: data.owner || userId`).
    owner: context.userId,
    variations: [
      {
        id: controlId,
        key: "0",
        name: "Control",
        description: "",
        screenshots: [],
      },
      {
        id: variantId,
        key: "1",
        name: "Variant 1",
        description: "",
        screenshots: [],
      },
    ],
    phases: [
      {
        coverage: 1,
        dateStarted: new Date(),
        name: "Main",
        reason: "",
        variationWeights: [0.5, 0.5],
        variations: [
          { id: controlId, status: "active" as const },
          { id: variantId, status: "active" as const },
        ],
        condition: "",
        namespace: { enabled: false, name: "", range: [0, 1] },
        seed: uuidv4(),
      },
    ],
  };

  let experiment;
  try {
    experiment = await createExperiment({
      data: experimentToCreate,
      context,
    });
  } catch (e) {
    logger.warn({ err: e }, "[visual-editor-ai] createExperiment failed");
    throw new Error(
      e instanceof Error
        ? `Could not create experiment: ${e.message}`
        : "Could not create experiment",
    );
  }

  // Observability: log the (id, owner, org) triple so we can sanity-
  // check owner attribution from server logs without inspecting the DB.
  // Will reveal any case where userId snuck through as empty despite
  // the guard, or where the model layer dropped the owner field.
  logger.info(
    {
      experimentId: experiment.id,
      owner: experiment.owner,
      orgId: context.org.id,
      userId: context.userId,
      project: project || null,
    },
    "[visual-editor-ai] experiment created",
  );

  // (The canCreateVisualChange permission was already verified up front,
  // before the experiment was created, so there's no orphan risk here.)

  // Attach an empty visual changeset. The omitted `visualChanges` arg
  // lets createVisualChangeset auto-generate one entry per variation
  // (with empty domMutations) via getLatestPhaseVariations — matches the
  // shape the side panel expects on load.
  const changeset = await createVisualChangeset({
    experiment,
    context,
    urlPatterns,
    editorUrl: pageUrl,
  });

  // Sanity narrow: createExperiment can in theory return any experiment
  // type (the discriminator includes "holdout"), but the visual-editor
  // creation flow always sets status/type to a standard experiment.
  // Fail loud if that invariant ever changes — better than silently
  // returning a malformed response shape from toExperimentApiInterface.
  if (experiment.type === "holdout") {
    throw new Error("Visual editor cannot create holdout experiments");
  }
  const apiExperiment = await resolveOwnerEmail(
    await toExperimentApiInterface(
      context,
      experiment as ExperimentInterfaceExcludingHoldouts,
    ),
    context,
  );

  return {
    experiment: apiExperiment,
    visualChangeset: toVisualChangesetApiInterface(changeset),
    // The side panel uses this to navigate the active tab to the editor
    // URL with the changeset id appended, so refreshes resume editing.
    editorRedirectUrl: appendChangesetParam(pageUrl, changeset.id),
  };
});

// Appends the changeset query param to a URL while preserving anything
// else the user already had on it. The side panel's parser supports both
// the new `gb-visual-editor-v2` param and the legacy `vc-id` — we emit
// the new one.
function appendChangesetParam(url: string, changesetId: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("gb-visual-editor-v2", changesetId);
    return u.toString();
  } catch {
    // If the URL is somehow malformed, return it untouched — the panel
    // can recover via the changeset id returned in the same response.
    return url;
  }
}
