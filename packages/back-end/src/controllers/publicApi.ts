import { Request, Response } from "express";
import { FeatureInterface } from "../../types/feature";
import { deleteFeature, getFeature } from "../models/FeatureModel";
import {
  createFeatureService,
  updateFeatureService,
} from "../services/features";
import { getOrgByAccessTokenReq } from "../services/organizations";

export function getHealthCheck(req: Request, res: Response) {
  return res.status(200).json({
    status: 200,
    healthy: true,
  });
}

export async function postFeatureApi(req: Request, res: Response) {
  const { featureId } = req.params;
  const feature: FeatureInterface = req.body;
  const org = await getOrgByAccessTokenReq(req);

  feature.id = featureId;
  feature.organization = org.id;

  const resultFeature = await createFeatureService(feature);

  //todo: add audit

  return res.status(200).json({
    status: 200,
    resultFeature,
  });
}

export async function putFeatureApi(req: Request, res: Response) {
  const { featureId } = req.params;
  const org = await getOrgByAccessTokenReq(req);
  const feature = await getFeature(org.id, featureId);

  if (!feature) throw new Error("Could not find feature");

  const updates = req.body;

  const newFeature = await updateFeatureService(updates, feature, feature.id);

  //todo: add audit

  res.status(200).json({
    feature: {
      ...newFeature,
      dateUpdated: new Date(),
    },
    status: 200,
  });
}

export async function deleteFeatureApi(req: Request, res: Response) {
  const { featureId } = req.params;
  const org = await getOrgByAccessTokenReq(req);

  const deleteRes = await deleteFeature(org.id, featureId);
  if (deleteRes.deletedCount === 0) throw new Error("Feature not found");

  //todo: add audit

  return res.status(200).json({
    status: 200,
    message: "Feature deleted successfully",
  });
}
