import { z } from "zod";
import uniqid from "uniqid";
import { v4 as uuidv4 } from "uuid";
import type {
  ExperimentInterface,
  ExperimentInterfaceExcludingHoldouts,
} from "shared/validators";
import { createExperiment } from "back-end/src/models/ExperimentModel";
import { SoftWarningError } from "back-end/src/util/errors";
import {
  createVisualChangeset,
  toVisualChangesetApiInterface,
} from "back-end/src/models/VisualChangesetModel";
import { toExperimentApiInterface } from "back-end/src/services/experiments";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { logger } from "back-end/src/util/logger";
import { requireUserAuth } from "./requireUserAuth";

const bodySchema = z
  .object({
    name: z.string().min(1).max(200),
    // Active tab URL at create time — used as the changeset's editorUrl
    // (where to navigate back to when resuming).
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
    project: z.string().optional(),
    // No server-side default: guessing "id" would silently mis-bucket orgs
    // whose primary identifier is something else (device_id, user_uuid, etc.).
    // The side panel surfaces the org's hashable attributes from
    // /visual-editor/bootstrap and passes an explicit value.
    hashAttribute: z.string().min(1).max(100),
    hypothesis: z.string().max(2000).optional(),
    description: z.string().max(2000).optional(),
    // Standard A/B experiment (default) or a multi-armed bandit. Bandits
    // require the "multi-armed-bandits" premium feature (enforced below).
    type: z.enum(["standard", "multi-armed-bandit"]).default("standard"),
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
  // Internal Visual Editor extension endpoint — not part of the
  // public OpenAPI spec.
  excludeFromSpec: true,
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
    type,
  } = req.body;
  const context = req.context;
  requireUserAuth(context);

  // Check both permissions up front so we don't leave a half-built
  // experiment behind if the changeset permission check fails post-write.
  if (!context.permissions.canCreateExperiment({ project })) {
    context.permissions.throwPermissionError();
  }
  if (!context.permissions.canCreateVisualChange({ project })) {
    context.permissions.throwPermissionError();
  }

  // Bandits are a premium feature. Gate here so the extension surfaces a
  // clear message rather than silently downgrading to a standard test.
  if (
    type === "multi-armed-bandit" &&
    !context.hasPremiumFeature("multi-armed-bandits")
  ) {
    throw new Error(
      "Multi-armed bandits aren’t included in your plan. Upgrade to Pro or Enterprise to run bandits.",
    );
  }

  // "draft" so it doesn't fire until the user finishes setup in GrowthBook.
  const controlId = uniqid("var_");
  const variantId = uniqid("var_");
  const experimentToCreate: Partial<ExperimentInterface> = {
    name,
    type,
    status: "draft",
    hashAttribute,
    trackingKey: "", // createExperiment auto-generates one
    description: description || "",
    hypothesis: hypothesis || "",
    project,
    // createExperiment doesn't fall back to context.userId, so we set it
    // explicitly.
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
    // Bandit-specific settings. Bandits must use the Bayesian engine and
    // need a reallocation schedule + burn-in. These mirror GrowthBook's
    // defaults (1 day each) and can be tuned later in the web app; the
    // user picks the single decision metric there before starting.
    ...(type === "multi-armed-bandit"
      ? {
          statsEngine: "bayesian" as const,
          banditScheduleValue: 1,
          banditScheduleUnit: "days" as const,
          banditBurnInValue: 1,
          banditBurnInUnit: "days" as const,
        }
      : {}),
  };

  let experiment;
  try {
    experiment = await createExperiment({
      data: experimentToCreate,
      context,
    });
  } catch (e) {
    if (e instanceof SoftWarningError) throw e;
    logger.warn({ err: e }, "[visual-editor-ai] createExperiment failed");
    throw new Error(
      e instanceof Error
        ? `Could not create experiment: ${e.message}`
        : "Could not create experiment",
    );
  }

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

  // Omitting `visualChanges` makes createVisualChangeset auto-generate
  // one empty entry per variation via getLatestPhaseVariations.
  const changeset = await createVisualChangeset({
    experiment,
    context,
    urlPatterns,
    editorUrl: pageUrl,
  });

  // toExperimentApiInterface's signature excludes holdouts; fail loud
  // rather than returning a malformed response.
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
    editorRedirectUrl: appendChangesetParam(pageUrl, changeset.id),
  };
});

// The side panel parser also accepts the legacy `vc-id`, but we emit
// `gb-visual-editor-v2` for new flows.
function appendChangesetParam(url: string, changesetId: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("gb-visual-editor-v2", changesetId);
    return u.toString();
  } catch {
    // Malformed URL — the panel can still recover via the changeset id
    // in the response body.
    return url;
  }
}
