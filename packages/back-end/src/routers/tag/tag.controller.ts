import type { Response } from "express";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ApiErrorResponse } from "back-end/types/api";
import { getContextFromReq } from "back-end/src/services/organizations";
import { TagInterface } from "back-end/types/tag";
import { addTag, removeTag } from "back-end/src/models/TagModel";
import { removeTagInMetrics } from "back-end/src/models/MetricModel";
import { removeTagInFeature } from "back-end/src/models/FeatureModel";
import { removeTagFromSlackIntegration } from "back-end/src/models/SlackIntegrationModel";
import { removeTagFromExperiments } from "back-end/src/models/ExperimentModel";
import { EventUserForResponseLocals } from "back-end/src/events/event-types";

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
  const { id, color, description } = req.body;

  await addTag(context.org.id, id, color, description);

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

  res.status(200).json({
    status: 200,
  });
};

// endregion DELETE /tag/:id
