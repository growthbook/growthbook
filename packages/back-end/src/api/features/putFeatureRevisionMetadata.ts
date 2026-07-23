import type { OrganizationInterface } from "shared/types/organization";
import { putFeatureRevisionMetadataValidator } from "shared/validators";
import { RevisionChanges } from "shared/types/feature-revision";
import type { ApiReqContext } from "back-end/types/api";
import { toApiRevision } from "back-end/src/services/features";
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

export type RevisionMetadataBody = {
  comment?: string;
  title?: string;
  description?: string;
  owner?: unknown;
  project?: string;
  tags?: string[];
  neverStale?: boolean;
  customFields?: Record<string, unknown>;
  [k: string]: unknown;
};

export async function setRevisionMetadata(
  context: ApiReqContext,
  organization: OrganizationInterface,
  params: { id: string; version: number | "new" },
  body: RevisionMetadataBody,
) {
  const feature = await getFeature(context, params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (!context.permissions.canManageFeatureDrafts(feature)) {
    context.permissions.throwPermissionError();
  }

  const { comment, title, ...metadataFields } = body;

  if (
    metadataFields.project !== undefined &&
    metadataFields.project !== feature.project
  ) {
    if (
      context.org.settings?.requireProjectForFeatures &&
      feature.project &&
      metadataFields.project === ""
    ) {
      throw new BadRequestError("Must specify a project");
    }

    if (metadataFields.project) {
      await context.models.projects.ensureProjectsExist([
        metadataFields.project,
      ]);
    }

    const orgEnvs = getEnvironmentIdsFromOrg(context.org);
    const enabledEnvs = Array.from(getEnabledEnvironments(feature, orgEnvs));
    if (
      !context.permissions.canPublishFeature(feature, enabledEnvs) ||
      !context.permissions.canPublishFeature(
        { project: metadataFields.project },
        enabledEnvs,
      )
    ) {
      context.permissions.throwPermissionError();
    }
  }

  if (metadataFields.customFields !== undefined) {
    await validateCustomFields(
      metadataFields.customFields as Record<string, unknown>,
      context,
      metadataFields.project ?? feature.project,
    );
  }

  const { revision, created } = await resolveOrCreateRevision(
    context,
    organization.id,
    feature,
    params.version,
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
      changes.metadata = {
        ...(revision.metadata ?? {}),
        ...(metadataFields as Partial<
          NonNullable<RevisionChanges["metadata"]>
        >),
      };
    }

    if (Object.keys(changes).length === 0) {
      // No-op: drop any auto-created draft so it doesn't leak.
      await discardIfJustCreated(context, revision, created);
      return { feature, revision };
    }

    // Tags are registered in the org's tag collection on publish (not here)
    // so discarded drafts don't leak orphaned tags.
    await updateRevision(
      context,
      feature,
      revision,
      changes,
      {
        user: context.auditUser,
        action: "edit metadata",
        subject: "",
        value: JSON.stringify(changes),
      },
      false,
    );

    const updated = await getRevision({
      context,
      organization: organization.id,
      featureId: feature.id,
      feature,
      version: revision.version,
    });
    const finalRevision = updated ?? revision;

    await recordRevisionUpdate(context, feature, finalRevision, "metadata", {
      auditDetails: { fields: Object.keys(changes) },
    });

    return { feature, revision: finalRevision };
  } catch (err) {
    await discardIfJustCreated(context, revision, created);
    throw err;
  }
}

export const putFeatureRevisionMetadata = createApiRequestHandler(
  putFeatureRevisionMetadataValidator,
)(async (req) => {
  const { feature, revision } = await setRevisionMetadata(
    req.context,
    req.organization,
    req.params,
    req.body,
  );
  return { revision: toApiRevision(revision, req.context, feature) };
});
