import omit from "lodash/omit";
import { z } from "zod";
import { JSONSchemaDef } from "shared/validators";
import { RevisionChanges } from "shared/types/feature-revision";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { addTagsDiff } from "back-end/src/models/TagModel";
import { getEnabledEnvironments } from "back-end/src/util/features";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";
import {
  isDraftStatus,
  validateCustomFields,
  resolveOrCreateRevision,
  versionOrNew,
} from "./validations";

export const putFeatureRevisionMetadata = createApiRequestHandler({
  paramsSchema: z.object({ id: z.string(), version: versionOrNew }),
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
  }),
})(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (
    !req.context.permissions.canUpdateFeature(feature, {}) ||
    !req.context.permissions.canManageFeatureDrafts(feature)
  ) {
    req.context.permissions.throwPermissionError();
  }

  const revision = await resolveOrCreateRevision(
    req.context,
    req.organization.id,
    feature,
    req.params.version,
  );

  if (!isDraftStatus(revision.status)) {
    throw new BadRequestError(
      `Cannot edit a revision with status "${revision.status}"`,
    );
  }

  const { comment, title, ...metadataFields } = req.body;

  // Project changes affect SDK payload visibility and may be blocked by org
  // settings — mirror the controller's putFeature guards.
  if (
    metadataFields.project !== undefined &&
    metadataFields.project !== feature.project
  ) {
    if (
      req.context.org.settings?.requireProjectForFeatures &&
      feature.project &&
      metadataFields.project === ""
    ) {
      throw new BadRequestError("Must specify a project");
    }

    if (metadataFields.project) {
      await req.context.models.projects.ensureProjectsExist([
        metadataFields.project,
      ]);
    }

    const orgEnvs = getEnvironmentIdsFromOrg(req.context.org);
    const enabledEnvs = Array.from(getEnabledEnvironments(feature, orgEnvs));
    if (
      !req.context.permissions.canPublishFeature(feature, enabledEnvs) ||
      !req.context.permissions.canPublishFeature(
        { project: metadataFields.project },
        enabledEnvs,
      )
    ) {
      req.context.permissions.throwPermissionError();
    }
  }

  if (metadataFields.customFields !== undefined) {
    await validateCustomFields(
      metadataFields.customFields,
      req.context,
      metadataFields.project ?? feature.project,
    );
  }

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
      version: revision.version,
    });
    return { revision: omit(updated ?? revision, "organization") };
  }

  // Register any newly-introduced tags with the org
  if (metadataFields.tags !== undefined && Array.isArray(metadataFields.tags)) {
    await addTagsDiff(
      req.organization.id,
      feature.tags || [],
      metadataFields.tags,
    );
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
    version: revision.version,
  });

  return { revision: omit(updated ?? revision, "organization") };
});
