import omit from "lodash/omit";
import { z } from "zod";
import { featureValueType, JSONSchemaDef } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision
} from "back-end/src/models/FeatureRevisionModel";
import { RevisionChanges } from "shared/types/feature-revision";
import { isDraftStatus } from "./validations";

export const putFeatureRevisionMetadata = createApiRequestHandler({
  paramsSchema: z.object({ id: z.string(), version: z.coerce.number().int() }),
  bodySchema: z.object({
    // Revision-level fields
    comment: z.string().optional(),
    title: z.string().optional(),
    // Feature metadata snapshot fields
    description: z.string().optional(),
    owner: z.string().optional(),
    project: z.string().optional(),
    tags: z.array(z.string()).optional(),
    neverStale: z.boolean().optional(),
    customFields: z.record(z.string(), z.any()).optional(),
    jsonSchema: JSONSchemaDef.optional(),
    valueType: z.enum(featureValueType).optional(),
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

  if (!isDraftStatus(revision.status)) {
    throw new Error(`Cannot edit a revision with status "${revision.status}"`);
  }

  const { comment, title, ...metadataFields } = req.body;

  const changes: RevisionChanges = {};
  if (comment !== undefined) changes.comment = comment;
  if (title !== undefined) changes.title = title;

  if (Object.keys(metadataFields).length > 0) {
    // Merge onto existing metadata snapshot so unspecified fields aren't dropped
    changes.metadata = { ...(revision.metadata ?? {}), ...metadataFields };
  }

  if (Object.keys(changes).length === 0) {
    const updated = await getRevision({
      context: req.context,
      organization: req.organization.id,
      featureId: feature.id,
      version: req.params.version,
    });
    return { revision: omit(updated ?? revision, "organization") };
  }

  await updateRevision(
    req.context,
    feature,
    revision,
    changes,
    {
      user: req.context.auditUser,
      action: "edit metadata",
      subject: "",
      value: JSON.stringify(changes),
    },
    false,
  );

  const updated = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });

  return { revision: omit(updated ?? revision, "organization") };
});
