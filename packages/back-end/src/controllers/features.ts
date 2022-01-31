import { AuthRequest } from "../types/AuthRequest";
import { Request, Response } from "express";
import { FeatureInterface, FeatureRule } from "../../types/feature";
import { getOrgFromReq } from "../services/organizations";
import {
  createFeature,
  deleteFeature,
  getAllFeatures,
  getFeature,
  updateFeature,
} from "../models/FeatureModel";
import { lookupOrganizationByApiKey } from "../services/apiKey";
import { featureUpdated, getFeatureDefinitions } from "../services/features";
import uniqid from "uniqid";

export async function getFeaturesPublic(req: Request, res: Response) {
  const { key } = req.params;

  try {
    const { organization, environment } = await lookupOrganizationByApiKey(key);
    if (!organization) {
      return res.status(400).json({
        status: 400,
        error: "Invalid API key",
      });
    }

    const features = await getFeatureDefinitions(organization, environment);

    // Cache for 30 seconds, serve stale up to 1 hour (10 hours if origin is down)
    res.set(
      "Cache-control",
      "public, max-age=30, stale-while-revalidate=3600, stale-if-error=36000"
    );

    res.status(200).json({
      status: 200,
      features,
    });
  } catch (e) {
    console.error(e);
    res.status(400).json({
      status: 400,
      error: "Failed to get features",
    });
  }
}

export async function postFeatures(
  req: AuthRequest<Partial<FeatureInterface>>,
  res: Response
) {
  const { id, ...otherProps } = req.body;
  const { org } = getOrgFromReq(req);

  if (!id) {
    throw new Error("Must specify feature key");
  }

  if (!id.match(/^[a-zA-Z0-9_.:|-]+$/)) {
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
    environments: ["dev"],
    ...otherProps,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: org.id,
    id: id.toLowerCase(),
  };

  if (feature.rules?.length) {
    feature.rules = feature.rules?.map((r) => {
      return {
        ...r,
        id: uniqid("fr_"),
      };
    });
  }

  await createFeature(feature);

  featureUpdated(feature);

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

  if (updates.rules) {
    updates.rules = updates.rules.map((r) => {
      if (r.id) return r;
      return {
        ...r,
        id: uniqid("fr_"),
      };
    });
  }

  // See if anything important changed that requires firing a webhook
  let requiresWebhook = false;
  if (
    "defaultValue" in updates &&
    updates.defaultValue !== feature.defaultValue
  ) {
    requiresWebhook = true;
  }
  if ("rules" in updates) {
    if (updates.rules?.length !== feature.rules?.length) {
      requiresWebhook = true;
    } else {
      updates.rules?.forEach((rule, i) => {
        const a = { ...rule } as Partial<FeatureRule>;
        const b = { ...feature.rules?.[i] } as Partial<FeatureRule>;
        delete a.description;
        delete a.id;
        delete b.description;
        delete b.id;

        if (JSON.stringify(a) !== JSON.stringify(b)) {
          requiresWebhook = true;
        }
      });
    }
  }
  if ("environments" in updates) {
    if (updates.environments?.length !== feature.environments?.length) {
      requiresWebhook = true;
    }
  }

  await updateFeature(feature.organization, id, {
    ...updates,
    dateUpdated: new Date(),
  });

  if (requiresWebhook) {
    featureUpdated(feature);
  }

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

  const feature = await getFeature(org.id, id);

  if (feature) {
    await deleteFeature(org.id, id);
    featureUpdated(feature);
  }

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
