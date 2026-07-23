import { PermissionError } from "shared/util";
import { deleteFeatureValidator } from "shared/validators";
import type { ApiRequestLocals } from "back-end/types/api";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { deleteFeature, getFeature } from "back-end/src/models/FeatureModel";
import { assertFeatureDeletable } from "back-end/src/services/features";
import { auditDetailsDelete } from "back-end/src/services/audit";
import { canUseRestApiBypassSetting } from "./reviewBypass";

// Single handler shared by v1 and v2: identical semantics, identical response
// shape (`{ deletedId }`). Only the deprecation marker on the route spec differs.
export async function deleteFeatureHandler(
  req: ApiRequestLocals & { params: { id: string } },
) {
  const feature = await getFeature(req.context, req.params.id);

  if (!feature) {
    throw new Error(
      `Unable to delete - could not find feature ID ${req.params.id}`,
    );
  }

  // Delete is gated by the delete permission; live-feature safety is enforced below.
  if (!req.context.permissions.canDeleteFeature(feature)) {
    req.context.permissions.throwPermissionError();
  }

  // Deleting a live (non-archived) feature is a production-affecting action.
  // Archived features can be deleted freely; unarchived ones require the org
  // to have opted in to unrestricted REST API writes. The project-scoped
  // bypassApprovalChecks permission intentionally does NOT authorize this path:
  // it is a review-workflow bypass, not a destructive-action override.
  if (!feature.archived) {
    if (!canUseRestApiBypassSetting(req)) {
      throw new PermissionError(
        "Cannot delete a live feature via the REST API when 'REST API always bypasses approval requirements' is disabled. " +
          "Archive the feature first, or enable the bypass setting in organization settings.",
      );
    }
  }

  // Reference integrity: deleting a feature that other live features gate on as
  // a prerequisite dangles their gate and drops them from the SDK payload, so
  // block regardless of archived state or REST bypass.
  await assertFeatureDeletable(req.context, feature.id);

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
}

export const deleteFeatureById = createApiRequestHandler(
  deleteFeatureValidator,
)(deleteFeatureHandler);
