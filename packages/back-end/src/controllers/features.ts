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
import { getRealtimeUsageByHour } from "../models/RealtimeModel";
import { lookupOrganizationByApiKey } from "../services/apiKey";
import { featureUpdated, getFeatureDefinitions } from "../services/features";
import uniqid from "uniqid";
import { getExperimentByTrackingKey } from "../services/experiments";
import { ExperimentDocument } from "../models/ExperimentModel";
import format from "date-fns/format";
import { getValidDate } from "../util/dates";
import { FeatureUsageRecords } from "../../types/realtime";
import { AuthRequest } from "../types/AuthRequest";

export async function getFeaturesPublic(req: Request, res: Response) {
  const { key } = req.params;

  let project = "";
  if (typeof req.query?.project === "string") {
    project = req.query.project;
  }

  try {
    const { organization, environment } = await lookupOrganizationByApiKey(key);
    if (!organization) {
      return res.status(400).json({
        status: 400,
        error: "Invalid API key",
      });
    }

    const features = await getFeatureDefinitions(
      organization,
      environment,
      project
    );

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
      if (r.type === "experiment" && !r?.trackingKey) {
        r.trackingKey = feature.id;
      }
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
      if (r.type === "experiment" && !r?.trackingKey) r.trackingKey = id;
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
  if ("project" in updates && updates.project !== feature.project) {
    requiresWebhook = true;
  }

  await updateFeature(feature.organization, id, {
    ...updates,
    dateUpdated: new Date(),
  });

  if (requiresWebhook) {
    featureUpdated(
      {
        ...feature,
        ...updates,
      },
      feature.environments || [],
      feature.project || ""
    );
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

  const experiments: { [key: string]: ExperimentDocument } = {};
  if (feature.rules) {
    const promises = feature.rules.map(async (r) => {
      if (r.type === "experiment" && r?.trackingKey) {
        const exp = await getExperimentByTrackingKey(org.id, r.trackingKey);
        if (exp) {
          experiments[r.trackingKey] = exp;
        }
      }
    });
    await Promise.all(promises);
  }

  res.status(200).json({
    status: 200,
    feature,
    experiments,
  });
}

export async function getFeaturesFrequencyMonth(
  req: AuthRequest<null, { num: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  let project = "";
  if (typeof req.query?.project === "string") {
    project = req.query.project;
  }

  const { num } = req.params;
  const features = await getAllFeatures(org.id, project);

  const allData: { name: string; numFeatures: number }[] = [];

  // make the data array with all the months needed and 0 experiments.
  for (let i = parseInt(num) - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const ob = {
      name: format(d, "MMM yyy"),
      numFeatures: 0,
    };
    allData.push(ob);
  }

  // create stubs for each month by all the statuses:
  const dataByType = {
    rollout: JSON.parse(JSON.stringify(allData)),
    experiment: JSON.parse(JSON.stringify(allData)),
    force: JSON.parse(JSON.stringify(allData)),
  };

  // now get the right number of experiments:
  features.forEach((f) => {
    const monthYear = format(getValidDate(f.dateCreated), "MMM yyy");

    allData.forEach((md, i) => {
      if (md.name === monthYear) {
        md.numFeatures++;
        // I can do this because the indexes will represent the same month
        if (f?.rules && f.rules.length > 0) {
          f.rules.forEach((o) => {
            dataByType[o.type][i].numFeatures++;
          });
        }
      }
    });
  });

  res.status(200).json({
    status: 200,
    data: { all: allData, ...dataByType },
  });
}

export async function getRealtimeUsage(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const NUM_MINUTES = 30;

  // Get feature usage for the current hour
  const now = new Date();
  const current = await getRealtimeUsageByHour(
    org.id,
    now.toISOString().substring(0, 13)
  );

  const usage: FeatureUsageRecords = {};
  if (current) {
    Object.keys(current.features).forEach((feature) => {
      usage[feature] = { realtime: [] };
      for (let i = now.getMinutes(); i >= 0; i--) {
        usage[feature].realtime.push({
          used: current.features[feature]?.used?.[i] || 0,
          skipped: current.features[feature]?.skipped?.[i] || 0,
        });
      }
    });
  }

  // If needed, pull in part of the previous hour to get to 30 data points
  if (now.getMinutes() < NUM_MINUTES - 1) {
    const stop = 59 - (NUM_MINUTES - 1 - now.getMinutes());
    const lastHour = new Date(now);
    lastHour.setHours(lastHour.getHours() - 1);

    const lastHourData = await getRealtimeUsageByHour(
      org.id,
      lastHour.toISOString().substring(0, 13)
    );
    if (lastHourData) {
      Object.keys(lastHourData.features).forEach((feature) => {
        if (!usage[feature]) {
          usage[feature] = {
            realtime: Array(now.getMinutes() + 1).fill({
              used: 0,
              skipped: 0,
            }),
          };
        }
        for (let i = 59; i >= stop; i--) {
          usage[feature].realtime.push({
            used: lastHourData.features[feature]?.used?.[i] || 0,
            skipped: lastHourData.features[feature]?.skipped?.[i] || 0,
          });
        }
      });
    }
  }

  // Pad out all usage arrays to 30 items and reverse arrays
  Object.keys(usage).forEach((feature) => {
    while (usage[feature].realtime.length < 30) {
      usage[feature].realtime.push({
        used: 0,
        skipped: 0,
      });
    }
    // Remove any extra items and reverse
    usage[feature].realtime = usage[feature].realtime.slice(0, 30);
    usage[feature].realtime.reverse();
  });

  res.status(200).json({
    status: 200,
    usage,
  });
}
