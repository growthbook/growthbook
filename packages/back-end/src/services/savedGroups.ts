import { OrganizationInterface } from "../../types/organization";
import { queueWebhook } from "../jobs/webhooks";
import { getAllFeatures } from "../models/FeatureModel";
import {
  getChangedEnvironmentsAndProjects,
  refreshSDKPayloadCache,
} from "./features";

export async function savedGroupUpdated(
  org: OrganizationInterface,
  id: string
) {
  const allFeatures = await getAllFeatures(org.id);

  // Only features that reference this saved group id in a condition are affected
  const { environments, projects } = await getChangedEnvironmentsAndProjects(
    org,
    allFeatures,
    (rule) => rule.condition && rule.condition.includes(id)
  );

  await refreshSDKPayloadCache(org, environments, projects, allFeatures);
  await queueWebhook(org.id, [...environments], [...projects], true);
}
