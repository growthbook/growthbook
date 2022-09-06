import { AuthRequest } from "../types/AuthRequest";
import { Response } from "express";
import { getOrgFromReq } from "../services/organizations";
import {
  addTag,
  removeTag,
  updateTag,
  validateTagName,
  validateUniqueTagName,
} from "../models/TagModel";
import { ExperimentModel } from "../models/ExperimentModel";
import { removeTagInMetrics, updateTagInMetrics } from "../models/MetricModel";
import { removeTagInFeature, updateTagInFeature } from "../models/FeatureModel";
import { TagInterface } from "../../types/tag";

export async function postTag(req: AuthRequest<TagInterface>, res: Response) {
  req.checkPermissions("organizationSettings");

  const { org } = getOrgFromReq(req);
  const { id, color, description } = req.body;

  await addTag(org.id, id, color, description);

  res.status(200).json({
    status: 200,
  });
}

export async function putTag(req: AuthRequest<TagInterface>, res: Response) {
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

export async function deleteTag(
  req: AuthRequest<{ id: string }>,
  res: Response
) {
  req.checkPermissions("organizationSettings");

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
}
