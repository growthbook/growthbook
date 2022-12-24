import { OrganizationInterface } from "../../types/organization";
import { ProjectInterface } from "../../types/project";
import { queueWebhook } from "../jobs/webhooks";
import { findAllProjectsByOrganization } from "../models/ProjectModel";
import { hasMatchingFeatureRule, refreshSDKPayloadCache } from "./features";
import { getEnvironments } from "./organizations";

export async function savedGroupUpdated(
  org: OrganizationInterface,
  id: string
) {
  const environments: string[] = await getEnvironments(org).map((env) => {
    return env.id;
  });

  const projects: string[] = (await findAllProjectsByOrganization(org.id)).map(
    (project: ProjectInterface) => {
      return project.id;
    }
  );

  await refreshSDKPayloadCache(org, {
    // Only features that reference this saved group id in a condition are affected
    filter: (f) =>
      hasMatchingFeatureRule(
        f,
        (r) => !!(r.condition && r.condition.includes(id))
      ),
  });

  // Call the webhook to update every feature for every environment and every project.
  await queueWebhook(org.id, environments, projects, true);
}
