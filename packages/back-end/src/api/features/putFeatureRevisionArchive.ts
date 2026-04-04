import omit from "lodash/omit";
import { z } from "zod";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";

const DRAFT_STATUSES = [
  "draft",
  "pending-review",
  "changes-requested",
  "approved",
];

export const putFeatureRevisionArchive = createApiRequestHandler({
  paramsSchema: z.object({ id: z.string(), version: z.coerce.number().int() }),
  bodySchema: z.object({
    archived: z.boolean(),
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

  const revision = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });
  if (!revision) throw new Error("Could not find feature revision");

  if (!DRAFT_STATUSES.includes(revision.status)) {
    throw new Error(`Cannot edit a revision with status "${revision.status}"`);
  }

  await updateRevision(
    req.context,
    feature,
    revision,
    { archived: req.body.archived },
    {
      user: req.context.auditUser,
      action: req.body.archived ? "archive feature" : "unarchive feature",
      subject: "",
      value: JSON.stringify({ archived: req.body.archived }),
    },
    true,
  );

  const updated = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });

  return { revision: omit(updated ?? revision, "organization") };
});
