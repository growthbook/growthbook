import { AuthRequest } from "../types/AuthRequest";
import { Response } from "express";
import { getOrgFromReq } from "../services/organizations";
import { addTag, removeTag } from "../models/TagModel";
import { ExperimentModel } from "../models/ExperimentModel";
import { removeTagInMetrics } from "../models/MetricModel";
import { removeTagInFeature } from "../models/FeatureModel";
import { TagInterface } from "../../types/tag";

export async function postTag(req: AuthRequest<TagInterface>, res: Response) {
  const { org } = getOrgFromReq(req);
  if (!req.permissions.organizationSettings) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }
  const { id, color, description } = req.body;

  await addTag(org.id, id, color, description);

  res.status(200).json({
    status: 200,
  });
}

export async function deleteTag(
  req: AuthRequest<{ id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  if (!req.permissions.organizationSettings) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }

  // experiments
  const query = { organization: org.id, tags: id };
  await ExperimentModel.updateMany(query, {
    $pull: { tags: id },
  });

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
