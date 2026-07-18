import { ReqContext } from "back-end/types/request";
import { removeProjectFromDatasources } from "back-end/src/models/DataSourceModel";
import { removeProjectFromMetrics } from "back-end/src/models/MetricModel";
import { removeProjectFromFeatures } from "back-end/src/models/FeatureModel";
import { removeProjectFromExperiments } from "back-end/src/models/ExperimentModel";
import { removeProjectFromSlackIntegration } from "back-end/src/models/SlackIntegrationModel";
import { removeProjectFromProjectRoles } from "back-end/src/models/OrganizationModel";

/**
 * Remove all references to a project from multi-project resources and
 * org-level settings without deleting the resources themselves. The resources
 * survive and fall back to "All Projects".
 *
 * Returns labels of resource groups that failed to clean up so callers can
 * report partial failures.
 */
export async function cleanupProjectReferences(
  context: ReqContext,
  projectId: string,
): Promise<string[]> {
  const failed: string[] = [];

  const steps: [string, () => Promise<unknown>][] = [
    [
      "data sources",
      () => removeProjectFromDatasources(projectId, context.org.id),
    ],
    ["metrics", () => removeProjectFromMetrics(projectId, context.org.id)],
    ["features", () => removeProjectFromFeatures(context, projectId)],
    ["experiments", () => removeProjectFromExperiments(context, projectId)],
    [
      "Slack integrations",
      () =>
        removeProjectFromSlackIntegration({
          organizationId: context.org.id,
          projectId,
        }),
    ],
    [
      "project roles",
      () => removeProjectFromProjectRoles(projectId, context.org),
    ],
    [
      "saved groups",
      () => context.models.savedGroups.removeProjectIdFromAllGroups(projectId),
    ],
    [
      "constants",
      () => context.models.constants.removeProjectIdFromAll(projectId),
    ],
    ["configs", () => context.models.configs.removeProjectIdFromAll(projectId)],
  ];

  for (const [label, run] of steps) {
    try {
      await run();
    } catch (e) {
      failed.push(label);
    }
  }

  return failed;
}
