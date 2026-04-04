import omit from "lodash/omit";
import { z } from "zod";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import { createRevision } from "back-end/src/models/FeatureRevisionModel";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";

export const postFeatureRevision = createApiRequestHandler({
  paramsSchema: z.object({ id: z.string() }),
  bodySchema: z.object({
    comment: z.string().optional().default(""),
    title: z.string().optional(),
    baseVersion: z.number().int().optional(),
  }),
})(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new Error("Could not find feature");

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
    baseVersion: req.body.baseVersion ?? feature.version,
    comment: req.body.comment,
    title: req.body.title,
    environments,
    publish: false,
    changes: {},
    org: req.context.org,
    canBypassApprovalChecks: false,
  });

  return { revision: omit(newDraft, "organization") };
});
