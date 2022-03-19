import { AuthRequest } from "../types/AuthRequest";
import { Response } from "express";
import { getOrgFromReq } from "../services/organizations";
import { addTag, getAllTags, removeTag } from "../services/tag";
import { ExperimentModel } from "../models/ExperimentModel";
import { removeTagInMetrics } from "../models/MetricModel";
import { removeTagInFeature } from "../models/FeatureModel";

export async function getTags(req: AuthRequest, res: Response) {
  const { org } = getOrgFromReq(req);
  const tags = await getAllTags(org.id);
  res.status(200).json({
    status: 200,
    tags,
  });
}

export async function putTag(
  req: AuthRequest<{
    name: string;
    color: string;
    description: string;
  }>,
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
  const allTags = await getAllTags(org.id);
  if ("tags" in allTags && !allTags.tags.includes(id)) {
    return res.status(404).json({
      status: 404,
      message: "Tag not found.",
    });
  }

  // we're just going to remove the old tag
  await removeTag(org.id, id);

  // then re add it
  const { name, color, description } = req.body;

  try {
    // upsert in the add tag
    await addTag(org.id, name, color, description);

    res.status(200).json({
      status: 200,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "An error occurred",
    });
  }
}

export async function postTag(
  req: AuthRequest<{
    name: string;
    color: string;
    description: string;
  }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  if (!req.permissions.organizationSettings) {
    return res.status(403).json({
      status: 403,
      message: "You do not have permission to perform that action.",
    });
  }
  const { name, color, description } = req.body;

  const allTags = await getAllTags(org.id);
  if ("tags" in allTags && allTags.tags.includes(name)) {
    return res.status(404).json({
      status: 404,
      message: "Tag already exists.",
    });
  }

  try {
    // upsert in the add tag
    await addTag(org.id, name, color, description);

    res.status(200).json({
      status: 200,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "An error occurred",
    });
  }
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

  // remove all usage of this tag:

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
