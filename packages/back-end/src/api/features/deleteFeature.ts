import { filterEnvironmentsByFeature, PermissionError } from "shared/util";
import { deleteFeatureValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { deleteFeature, getFeature } from "back-end/src/models/FeatureModel";
import { auditDetailsDelete } from "back-end/src/services/audit";
import { getEnvironments } from "back-end/src/util/organization.util";
import { getEnabledEnvironments } from "back-end/src/util/features";

export const deleteFeatureById = createApiRequestHandler(
  deleteFeatureValidator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);

  if (!feature) {
    throw new Error(
      `Unable to delete - could not find feature ID ${req.params.id}`,
    );
  }

  const allEnvironments = getEnvironments(req.context.org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentsIds = environments.map((e) => e.id);

  if (
    !req.context.permissions.canDeleteFeature(feature) ||
    !req.context.permissions.canManageFeatureDrafts(feature) ||
    !req.context.permissions.canPublishFeature(
      feature,
      Array.from(getEnabledEnvironments(feature, environmentsIds)),
    )
  ) {
    req.context.permissions.throwPermissionError();
  }

  // Deleting a live (non-archived) feature is a production-affecting action.
  // Archived features can be deleted freely; unarchived ones require the org
  // to have opted in to unrestricted REST API writes. The project-scoped
  // bypassApprovalChecks permission intentionally does NOT authorize this path:
  // it is a review-workflow bypass, not a destructive-action override.
  if (!feature.archived) {
    const apiBypassesReviews =
      !!req.context.org.settings?.restApiBypassesReviews;
    if (!apiBypassesReviews) {
      throw new PermissionError(
        "Cannot delete a live feature via the REST API when 'REST API always bypasses approval requirements' is disabled. " +
          "Archive the feature first, or enable the bypass setting in organization settings.",
      );
    }
  }

  await deleteFeature(req.context, feature);

  await req.audit({
    event: "feature.delete",
    entity: {
      object: "feature",
      id: req.params.id,
    },
    details: auditDetailsDelete(feature),
  });

  return {
    deletedId: req.params.id,
  };
});
