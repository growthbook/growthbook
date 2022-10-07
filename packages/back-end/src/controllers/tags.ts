import { AuthRequest } from "../types/AuthRequest";
import { Response } from "express";
import { getOrgFromReq } from "../services/organizations";
import { addTag, removeTag } from "../models/TagModel";
import { ExperimentModel } from "../models/ExperimentModel";
import { removeTagInMetrics } from "../models/MetricModel";
import { removeTagInFeature } from "../models/FeatureModel";
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

export async function deleteTag(
  req: AuthRequest<{ id: string }, { id: string }>,
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
