import { OrganizationInterface } from "../../types/organization";
import { ProjectInterface } from "../../types/project";
import { queueWebhook } from "../jobs/webhooks";
import { findAllProjectsByOrganization } from "../models/ProjectModel";
import { getEnvironments } from "./organizations";

export async function savedGroupUpdated(org: OrganizationInterface) {
  const environments: string[] = await getEnvironments(org).map((env) => {
    return env.id;
  });

  const projects: string[] = (await findAllProjectsByOrganization(org.id)).map(
    (project: ProjectInterface) => {
      return project.id;
    }
  );

  // Call the webhook to update every feature for every environment and every project.
  await queueWebhook(org.id, environments, projects, true);
}
