import omit from "lodash/omit";
import { z } from "zod";
import {
  autoMerge,
  checkIfRevisionNeedsReview,
  fillRevisionFromFeature,
  filterEnvironmentsByFeature,
  liveRevisionFromFeature,
} from "shared/util";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature, publishRevision } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { getLiveAndBaseRevisionsForFeature } from "back-end/src/services/features";
import { getEnvironments } from "back-end/src/util/organization.util";
import { getEnabledEnvironments } from "back-end/src/util/features";
import { ConflictError, NotFoundError } from "back-end/src/util/errors";

export const postFeatureRevisionPublish = createApiRequestHandler({
  paramsSchema: z.object({ id: z.string(), version: z.coerce.number().int() }),
  bodySchema: z.object({
    comment: z.string().optional().default(""),
    adminOverride: z.boolean().optional().default(false),
  }),
})(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (!req.context.permissions.canUpdateFeature(feature, {})) {
    req.context.permissions.throwPermissionError();
  }

  const revision = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });
  if (!revision) throw new NotFoundError("Could not find feature revision");

  if (revision.status === "published" || revision.status === "discarded") {
    throw new Error(
      `Cannot publish a revision with status "${revision.status}"`,
    );
  }

  const allEnvironments = getEnvironments(req.context.org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);

  const { live, base } = await getLiveAndBaseRevisionsForFeature({
    context: req.context,
    feature,
    revision,
  });

  // Run merge first so review requirements are evaluated against the effective
  // post-merge state — mirrors what the controller and frontend do.
  const mergeResult = autoMerge(
    liveRevisionFromFeature(live, feature),
    fillRevisionFromFeature(base, feature),
    revision,
    environmentIds,
    {},
  );

  if (!mergeResult.success) {
    throw new ConflictError(
      "Merge conflicts exist — rebase before publishing",
      mergeResult.conflicts,
    );
  }

  // Build effectiveRevision from merged result layered on live (same as controller).
  const filledLive = {
    ...live,
    ...liveRevisionFromFeature(live, feature),
  };
  const effectiveRevision = {
    ...filledLive,
    ...mergeResult.result,
    rules: {
      ...filledLive.rules,
      ...(mergeResult.result.rules ?? {}),
    },
  };

  const requiresReview = checkIfRevisionNeedsReview({
    feature,
    baseRevision: filledLive,
    revision: effectiveRevision,
    allEnvironments: environmentIds,
    settings: req.organization.settings,
    requireApprovalsLicensed:
      req.context.hasPremiumFeature("require-approvals"),
  });

  const { adminOverride } = req.body;

  if (requiresReview && revision.status !== "approved") {
    if (!adminOverride) {
      throw new Error(
        `This revision requires approval before publishing (status: "${revision.status}"). ` +
          "Pass adminOverride: true if your organization allows REST API bypass.",
      );
    }
    if (!req.organization.settings?.restApiBypassesReviews) {
      throw new Error(
        "Cannot use adminOverride: your organization has not enabled 'REST API always bypasses approval requirements'.",
      );
    }
    if (!req.context.permissions.canBypassApprovalChecks(feature)) {
      req.context.permissions.throwPermissionError();
    }
  }

  // Check publish permission for the environments this revision actually touches.
  const allEnabledEnvs = Array.from(
    getEnabledEnvironments(feature, environmentIds),
  );
  if (mergeResult.result.defaultValue !== undefined) {
    if (!req.context.permissions.canPublishFeature(feature, allEnabledEnvs)) {
      req.context.permissions.throwPermissionError();
    }
  } else {
    const changedEnvs = Object.keys(mergeResult.result.rules || {});
    if (changedEnvs.length > 0) {
      if (!req.context.permissions.canPublishFeature(feature, changedEnvs)) {
        req.context.permissions.throwPermissionError();
      }
    }
  }

  const updatedFeature = await publishRevision(
    req.context,
    feature,
    revision,
    mergeResult.result,
    req.body.comment,
  );

  await req.audit({
    event: "feature.publish",
    entity: {
      object: "feature",
      id: feature.id,
    },
    details: auditDetailsUpdate(feature, updatedFeature, {
      revision: revision.version,
      comment: req.body.comment,
    }),
  });

  const updated = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });

  return { revision: omit(updated ?? revision, "organization") };
});
