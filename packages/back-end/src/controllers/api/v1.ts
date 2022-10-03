import { Response } from "express";
import { ApiV1Feature } from "../../../types/api/v1/feature";
import { getAllFeatures } from "../../models/FeatureModel";
import { formatApiFeature } from "../../services/api/v1";
import { AccessTokenRequest } from "../../types/AccessTokenRequest";

export function getHealthCheck(req: AccessTokenRequest, res: Response) {
  res.status(200).json({
    status: 200,
    healthy: true,
  });
}

export async function listFeaturesApi(req: AccessTokenRequest, res: Response) {
  const { organization } = req;

  let project = "";
  if (typeof req.query?.project === "string") {
    project = req.query.project;
  }

  const features = await getAllFeatures(organization.id, project);

  const retFeatures: ApiV1Feature[] = features.map((f) => formatApiFeature(f));

  res.status(200).json({
    status: 200,
    features: retFeatures,
  });
}
