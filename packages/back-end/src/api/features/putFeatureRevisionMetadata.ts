import { putFeatureRevisionMetadataValidator } from "shared/validators";
import { RevisionChanges } from "shared/types/feature-revision";
import { revisionToApiInterface } from "back-end/src/services/features";
import { recordRevisionUpdate } from "back-end/src/services/featureRevisionEvents";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { getEnabledEnvironments } from "back-end/src/util/features";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";
import {
  discardIfJustCreated,
  isDraftStatus,
  validateCustomFields,
  resolveOrCreateRevision,
} from "./validations";

export const putFeatureRevisionMetadata = createApiRequestHandler(
  putFeatureRevisionMetadataValidator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (
    !req.context.permissions.canUpdateFeature(feature, {}) ||
    !req.context.permissions.canManageFeatureDrafts(feature)
  ) {
    req.context.permissions.throwPermissionError();
  }

  const { comment, title, ...metadataFields } = req.body;

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

  const { revision, created } = await resolveOrCreateRevision(
    req.context,
    req.organization.id,
    feature,
    req.params.version,
    { title, comment },
  );

  try {
    if (!isDraftStatus(revision.status)) {
      throw new BadRequestError(
        `Cannot edit a revision with status "${revision.status}"`,
      );
    }

    const changes: RevisionChanges = {};
    if (comment !== undefined) changes.comment = comment;
    if (title !== undefined) changes.title = title;

    if (Object.keys(metadataFields).length > 0) {
      // Merge into the existing metadata snapshot so omitted fields persist.
      changes.metadata = { ...(revision.metadata ?? {}), ...metadataFields };
    }

    if (Object.keys(changes).length === 0) {
      // No-op: drop any auto-created draft so it doesn't leak.
      await discardIfJustCreated(req.context, revision, created);
      return { revision: revisionToApiInterface(revision) };
    }

    // Tags are registered in the org's tag collection on publish (not here)
    // so discarded drafts don't leak orphaned tags.
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
    const finalRevision = updated ?? revision;

    await recordRevisionUpdate(
      req.context,
      feature,
      finalRevision,
      "metadata",
      { auditDetails: { fields: Object.keys(changes) } },
    );

    return { revision: revisionToApiInterface(finalRevision) };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
