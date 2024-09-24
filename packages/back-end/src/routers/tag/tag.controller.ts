import type { Response } from "express";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "../../services/audit";
import { AuthRequest } from "../../types/AuthRequest";
import { ApiErrorResponse } from "../../../types/api";
import { getContextFromReq } from "../../services/organizations";
import { TagInterface } from "../../../types/tag";
import {
  addTag,
  getAllTags,
  getTag,
  removeTag,
  updateTag,
} from "../../models/TagModel";
import { removeTagInMetrics } from "../../models/MetricModel";
import { removeTagInFeature } from "../../models/FeatureModel";
import { removeTagFromSlackIntegration } from "../../models/SlackIntegrationModel";
import { removeTagFromExperiments } from "../../models/ExperimentModel";
import { EventUserForResponseLocals } from "../../events/event-types";

// region POST /tag

type CreateTagRequest = AuthRequest<TagInterface>;

type CreateTagResponse = {
  status: 200;
};

/**
 * POST /tag
 * Create a tag resource
 * @param req
 * @param res
 */
export const postTag = async (
  req: CreateTagRequest,
  res: Response<CreateTagResponse>
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canCreateAndUpdateTag()) {
    context.permissions.throwPermissionError();
  }
  const { id, color, description, label } = req.body;

  // make sure it doesn't already exist:
  const existing = await getAllTags(context.org.id);
  const matchingId = existing.find((tag) => tag.id === id);
  const matchingLabel = existing.find((tag) => tag.label === label);

  if (matchingId) {
    throw new Error("A Tag with this id already exists");
  }
  if (matchingLabel) {
    throw new Error("A Tag with this name already exists");
  }
  // add the tag:
  await addTag(context.org.id, id, color, description, label);

  // audit log:
  await req.audit({
    event: "tag.create",
    entity: {
      object: "organization",
      id: context.org.id,
    },
    details: auditDetailsCreate({ id, color, description, label }),
  });

  res.status(200).json({
    status: 200,
  });
};

type PutTagResponse = {
  status: 200;
};

/**
 * PUT /tag/:id
 * Update a tag by id
 * @param req
 * @param res
 */
export const putTag = async (
  req: AuthRequest<TagInterface, { id: string }>,
  res: Response<PutTagResponse>
) => {
  const context = getContextFromReq(req);
  if (!context.permissions.canCreateAndUpdateTag()) {
    context.permissions.throwPermissionError();
  }
  const { label, color, description } = req.body;
  const { id } = req.params;
  const existing = await getAllTags(context.org.id);
  const matchingId = existing.find((tag) => tag.id === id);
  const matchingLabel = existing.find((tag) => tag.label === label);
  if (!matchingId) {
    throw new Error("Tag not found");
  }
  if (matchingLabel) {
    throw new Error("A Tag with this name already exists");
  }
  await updateTag(context.org.id, id, color, description, label);

  // audit log:
  await req.audit({
    event: "tag.update",
    entity: {
      object: "organization",
      id: context.org.id,
    },
    details: auditDetailsUpdate(
      { tag: existing },
      {
        tag: {
          id,
          color,
          description,
          label,
        },
      }
    ),
  });
  res.status(200).json({
    status: 200,
  });
};

// region DELETE /tag/:id

type DeleteTagRequest = AuthRequest<{ id: string }, { id: string }>;

type DeleteTagResponse = {
  status: 200;
};

/**
 * DELETE /tag/
 * Delete one tag resource by ID
 * @param req
 * @param res
 */
export const deleteTag = async (
  req: DeleteTagRequest,
  res: Response<
    DeleteTagResponse | ApiErrorResponse,
    EventUserForResponseLocals
  >
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canDeleteTag()) {
    context.permissions.throwPermissionError();
  }
  const { org } = context;
  const { id } = req.body;

  // check if the tag exists
  const existing = await getTag(org.id, id);
  if (!existing) {
    throw new Error("Tag not found");
  }
  // experiments
  await removeTagFromExperiments({
    context,
    tag: id,
  });

  // metrics
  await removeTagInMetrics(org.id, id);

  // features
  await removeTagInFeature(context, id);

  // Slack integrations
  await removeTagFromSlackIntegration({ organizationId: org.id, tag: id });

  // finally, remove the tag itself
  await removeTag(org.id, id);

  await req.audit({
    event: "tag.delete",
    entity: {
      object: "organization",
      id: org.id,
    },
    details: auditDetailsDelete(existing),
  });

  res.status(200).json({
    status: 200,
  });
};

// endregion DELETE /tag/:id
