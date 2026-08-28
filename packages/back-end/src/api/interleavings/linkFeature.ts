import { linkInterleavingFeatureValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import { linkFeatureToInterleaving } from "back-end/src/enterprise/services/interleavings";
import { loadInterleavingForRead } from "./_shared";

export const linkInterleavingFeature = createApiRequestHandler(
  linkInterleavingFeatureValidator,
)(async (req) => {
  const { interleaving } = await loadInterleavingForRead(
    req.context,
    req.params.id,
  );

  if (
    !req.context.permissions.canUpdateInterleaving(interleaving, interleaving)
  ) {
    req.context.permissions.throwPermissionError();
  }

  const feature = await getFeature(req.context, req.body.featureId);
  if (!feature) {
    return req.context.throwNotFoundError(
      `Could not find a Feature Flag with id ${req.body.featureId}`,
    );
  }

  const { version, ruleId } = await linkFeatureToInterleaving({
    context: req.context,
    interleaving,
    feature,
    coverage: req.body.coverage,
    eventAudit: req.eventAudit,
    audit: req.audit,
  });

  return { featureId: feature.id, ruleId, revisionVersion: version };
});
