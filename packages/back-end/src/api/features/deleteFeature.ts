import { filterEnvironmentsByFeature, PermissionError } from "shared/util";
import { deleteFeatureValidator } from "shared/validators";
import { DeleteFeatureResponse } from "shared/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { deleteFeature, getFeature } from "back-end/src/models/FeatureModel";
import { auditDetailsDelete } from "back-end/src/services/audit";
import { getEnvironments } from "back-end/src/util/organization.util";
import { getEnabledEnvironments } from "back-end/src/util/features";

export const deleteFeatureById = createApiRequestHandler(
  deleteFeatureValidator,
)(async (req): Promise<DeleteFeatureResponse> => {
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
  // Archived features can be deleted freely; unarchived ones require both an
  // explicit adminOverride flag and the org-level bypass setting.
  if (!feature.archived) {
    if (!req.query.adminOverride) {
      throw new PermissionError(
        "Cannot delete a live feature via the REST API without passing `?adminOverride=true`. " +
          "Archive the feature first, or pass adminOverride=true if your organization allows REST API bypass.",
      );
    }
    if (!req.context.org.settings?.restApiBypassesReviews) {
      throw new PermissionError(
        "Cannot use adminOverride: your organization has not enabled 'REST API always bypasses approval requirements'.",
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
