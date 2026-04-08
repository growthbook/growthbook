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
  // Archived features can be deleted freely; unarchived ones require either
  // the org to have opted in to unrestricted REST API writes, or the caller
  // to hold the bypassApprovalChecks permission for the feature's project.
  if (!feature.archived) {
    const canBypass =
      !!req.context.org.settings?.restApiBypassesReviews ||
      req.context.permissions.canBypassApprovalChecks(feature);
    if (!canBypass) {
      throw new PermissionError(
        "Cannot delete a live feature via the REST API without approval-bypass access. " +
          "Archive the feature first, enable 'REST API always bypasses approval requirements' in organization settings, " +
          "or use a role/token that grants bypassApprovalChecks on this project.",
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
