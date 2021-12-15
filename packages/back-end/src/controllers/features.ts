import { AuthRequest } from "../types/AuthRequest";
import { Response } from "express";
import { FeatureInterface } from "../../types/feature";
import { getOrgFromReq } from "../services/organizations";
import {
  createFeature,
  deleteFeature,
  getAllFeatures,
  getFeature,
  updateFeature,
} from "../models/FeatureModel";

export async function postFeatures(
  req: AuthRequest<Partial<FeatureInterface>>,
  res: Response
) {
  const { id, ...otherProps } = req.body;
  const { org } = getOrgFromReq(req);

  if (!id) {
    throw new Error("Must specify feature key");
  }

  if (!id.match(/^[a-zA-Z0-9_-]+$/)) {
    throw new Error(
      "Feature keys can only include letters, numbers, hyphens, and underscores."
    );
  }

  const feature: FeatureInterface = {
    defaultValue: "",
    valueType: "boolean",
    description: "",
    project: "",
    rules: [],
    ...otherProps,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: org.id,
    id: id.toLowerCase(),
  };

  await createFeature(feature);

  res.status(200).json({
    status: 200,
    feature,
  });
}
export async function putFeature(
  req: AuthRequest<Partial<FeatureInterface>, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  const {
    id: newId,
    organization,
    dateUpdated,
    dateCreated,
    ...updates
  } = req.body;

  if (newId || organization || dateUpdated || dateCreated) {
    throw new Error("Invalid update fields for feature");
  }

  await updateFeature(feature.organization, id, {
    ...updates,
    dateUpdated: new Date(),
  });

  res.status(200).json({
    feature: {
      ...feature,
      ...updates,
      dateUpdated: new Date(),
    },
    status: 200,
  });
}

export async function deleteFeatureById(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { id } = req.params;
  const { org } = getOrgFromReq(req);

  await deleteFeature(org.id, id);

  res.status(200).json({
    status: 200,
  });
}

export async function getFeatures(req: AuthRequest, res: Response) {
  const { org } = getOrgFromReq(req);

  let project = "";
  if (typeof req.query?.project === "string") {
    project = req.query.project;
  }

  const features = await getAllFeatures(org.id, project);

  res.status(200).json({
    status: 200,
    features,
  });
}

export async function getFeatureById(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  res.status(200).json({
    status: 200,
    feature,
  });
}
