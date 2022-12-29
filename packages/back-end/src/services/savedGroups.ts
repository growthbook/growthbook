import { OrganizationInterface } from "../../types/organization";
import { getAllFeatures } from "../models/FeatureModel";
import { getAffectedEnvironmentsAndProjects } from "../util/features";
import { getEnvironments } from "./organizations";
import { hasMatchingFeatureRule, refreshSDKPayloadCache } from "./features";

export async function savedGroupUpdated(
  org: OrganizationInterface,
  id: string
) {
  const allFeatures = await getAllFeatures(org.id);
  // Only features that reference this saved group id in a condition are affected
  const changedFeatures = allFeatures
    .filter((feature) => !feature.archived)
    .filter((feature) =>
      hasMatchingFeatureRule(
        feature,
        // Do a simple string lookup in the serialized condition
        // Might have occasional false positives, but it's much faster than full parsing
        // False positives aren't too bad, they'll just cause the cache to be invalidated more frequently
        (rule) => rule.condition && rule.condition.includes(id)
      )
    );

  const { environments, projects } = getAffectedEnvironmentsAndProjects(
    changedFeatures,
    getEnvironments(org).map((e) => e.id)
  );

  await refreshSDKPayloadCache(org, environments, projects, allFeatures);
}
