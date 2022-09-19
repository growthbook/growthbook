import { Response } from "express";
import {
  CreateFeatureInterface,
  UpdateFeatureInterface,
} from "../../../types/feature/feature";
import {
  createFeature,
  deleteFeature,
  getAllFeatures,
  getFeature,
  updateFeature,
} from "../../models/FeatureModel";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "../../services/audit";
import { fireWebhook } from "../../services/features";
import { AccessTokenRequest } from "../../types/AccessTokenRequest";

export function getHealthCheck(req: AccessTokenRequest, res: Response) {
  res.status(200).json({
    status: 200,
    healthy: true,
  });
}

export async function getFeatureApi(req: AccessTokenRequest, res: Response) {
  const { featureId } = req.params;
  const { organization } = req;

  const feature = await getFeature(organization.id, featureId);
  if (!feature) throw new Error("Feature not found");

  res.status(200).json({
    status: 200,
    feature,
  });
}

export async function listFeaturesApi(req: AccessTokenRequest, res: Response) {
  const { organization } = req;

  let project = "";
  if (typeof req.query?.project === "string") {
    project = req.query.project;
  }

  const features = await getAllFeatures(organization.id, project);

  res.status(200).json({
    status: 200,
    features: features,
  });
}

export async function postFeatureApi(
  req: AccessTokenRequest<CreateFeatureInterface>,
  res: Response
) {
  const { featureId } = req.params;
  const { organization: org } = req;
  const feature = req.body;
  feature.id = featureId;

  const resultFeature = await createFeature(feature, org.id);

  await req.audit({
    event: "feature.create",
    entity: {
      object: "feature",
      id: featureId,
    },
    details: auditDetailsCreate(feature),
    accessTokenReq: true,
  });

  res.status(200).json({
    status: 200,
    feature: resultFeature,
  });
}

export async function putFeatureApi(
  req: AccessTokenRequest<UpdateFeatureInterface>,
  res: Response
) {
  const { featureId } = req.params;
  const { organization: org } = req;
  const updates = req.body;
  const feature = await getFeature(org.id, featureId);
  if (!feature) throw new Error("Could not find feature");

  await updateFeature(feature.organization, feature.id, { ...updates });
  const newFeature = { ...feature, ...updates };

  await fireWebhook(updates, feature, newFeature);

  await req.audit({
    event: "feature.update",
    entity: {
      object: "feature",
      id: featureId,
    },
    details: auditDetailsUpdate(feature, newFeature),
    accessTokenReq: true,
  });

  res.status(200).json({
    feature: {
      ...newFeature,
      dateUpdated: new Date(),
    },
    status: 200,
  });
}

export async function deleteFeatureApi(req: AccessTokenRequest, res: Response) {
  const { featureId } = req.params;
  const { organization: org } = req;

  const feature = await getFeature(org.id, featureId);
  if (!feature) throw new Error("Could not find feature");

  await deleteFeature(org.id, featureId);

  await req.audit({
    event: "feature.delete",
    entity: {
      object: "feature",
      id: featureId,
    },
    details: auditDetailsDelete(feature),
    accessTokenReq: true,
  });

  res.status(200).json({
    status: 200,
    message: "Feature deleted successfully",
  });
}
