import { postFeatureRevisionValidator } from "shared/validators";
import { revisionToApiInterface } from "back-end/src/services/features";
import { NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import { createRevision } from "back-end/src/models/FeatureRevisionModel";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";

export const postFeatureRevision = createApiRequestHandler(
  postFeatureRevisionValidator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (
    !req.context.permissions.canUpdateFeature(feature, {}) ||
    !req.context.permissions.canManageFeatureDrafts(feature)
  ) {
    req.context.permissions.throwPermissionError();
  }

  const environments = getEnvironmentIdsFromOrg(req.context.org);

  const newDraft = await createRevision({
    context: req.context,
    feature,
    user: req.context.auditUser,
    baseVersion: feature.version,
    comment: req.body.comment ?? "",
    title: req.body.title,
    environments,
    publish: false,
    changes: {},
    org: req.context.org,
    canBypassApprovalChecks: false,
  });

  return { revision: revisionToApiInterface(newDraft) };
});
