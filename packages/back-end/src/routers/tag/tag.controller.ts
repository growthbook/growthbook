import type { Response } from "express";
import { AuthRequest } from "../../types/AuthRequest";
import { ApiErrorResponse } from "../../../types/api";
import { getOrgFromReq } from "../../services/organizations";
import { TagInterface } from "../../../types/tag";
import {
  addTag,
  removeTag,
  updateTag,
  validateTagName,
  validateUniqueTagName,
} from "../../models/TagModel";
import { ExperimentModel } from "../../models/ExperimentModel";
import {
  removeTagInMetrics,
  updateTagInMetrics,
} from "../../models/MetricModel";
import {
  removeTagInFeature,
  updateTagInFeature,
} from "../../models/FeatureModel";

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
  req.checkPermissions("manageTags");

  const { org } = getOrgFromReq(req);
  const { id, color, description } = req.body;

  await addTag(org.id, id, color, description);

  res.status(200).json({
    status: 200,
  });
};

// endregion POST /tag

// region PUT /tag/:id

type PutTagRequest = AuthRequest<TagInterface, { id: string }>;

type PutTagResponse = {
  status: 200;
};

export async function putTag(
  req: PutTagRequest,
  res: Response<PutTagResponse>
) {
  req.checkPermissions("organizationSettings");

  const { id: originalId } = req.params;

  const { org } = getOrgFromReq(req);
  const { id, color, description } = req.body;

  if (!id) {
    throw new Error("Missing required tag name");
  }
  await validateTagName(id);

  if (originalId !== id) {
    // the name of the tag has changed, so we need to update all the experiments, metrics, and features
    await validateUniqueTagName(org.id, id);

    // update experiments
    await ExperimentModel.updateMany(
      { organization: org.id, tags: originalId },
      {
        $set: { "tags.$": id },
        arrayFilters: [{ tags: originalId }],
      }
    );

    // metrics
    await updateTagInMetrics(org.id, originalId, id);

    // features
    await updateTagInFeature(org.id, originalId, id);
  }

  await updateTag(org.id, originalId, id, color, description);

  res.status(200).json({
    status: 200,
  });
}

// region DELETE /tag/:id

type DeleteTagRequest = AuthRequest<{ id: string }, { id: string }>;

type DeleteTagResponse = {
  status: 200;
};

/**
 * DELETE /tag/:id
 * Delete one tag resource by ID
 * @param req
 * @param res
 */
export const deleteTag = async (
  req: DeleteTagRequest,
  res: Response<DeleteTagResponse | ApiErrorResponse>
) => {
  req.checkPermissions("manageTags");

  const { org } = getOrgFromReq(req);
  const { id } = req.params;

  // experiments
  await ExperimentModel.updateMany(
    { organization: org.id, tags: id },
    {
      $pull: { tags: id },
    }
  );

  // metrics
  await removeTagInMetrics(org.id, id);

  // features
  await removeTagInFeature(org.id, id);

  // finally, remove the tag itself
  await removeTag(org.id, id);

  res.status(200).json({
    status: 200,
  });
};

// endregion DELETE /tag/:id
