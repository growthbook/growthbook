import type { Response } from "express";
import { AuthRequest } from "../../types/AuthRequest";
import { ApiErrorResponse } from "../../../types/api";
import { getContextFromReq } from "../../services/organizations";
import { TagInterface } from "../../../types/tag";
import { addTag, removeTag } from "../../models/TagModel";
import { removeTagInMetrics } from "../../models/MetricModel";
import { removeTagInFeature } from "../../models/FeatureModel";
import { removeTagFromSlackIntegration } from "../../models/SlackIntegrationModel";
import { removeTagFromExperiments } from "../../models/ExperimentModel";
import { EventAuditUserForResponseLocals } from "../../events/event-types";

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
    EventAuditUserForResponseLocals
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
