import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";

// A rule naming something that does not exist gates nothing, so refuse it here
// rather than storing a requirement that silently never applies.
export async function assertApprovalRuleReferencesExist(
  context: ReqContext | ApiReqContext,
  rules: {
    projects?: string[];
    environments?: string[];
    requiredApproverTeams?: string[];
  }[],
) {
  const validProjects = new Set(await context.getAllProjectIds());
  const validEnvironments = new Set(
    (context.org.settings?.environments ?? []).map((e) => e.id),
  );
  const validTeams = new Set(
    (await context.models.teams.getAll()).map((t) => t.id),
  );

  rules.forEach((rule) => {
    (rule.projects ?? []).forEach((project) => {
      if (!validProjects.has(project)) {
        throw new Error(`${project} is not a valid project ID.`);
      }
    });
    (rule.environments ?? []).forEach((env) => {
      if (!validEnvironments.has(env)) {
        throw new Error(`${env} is not a valid environment ID.`);
      }
    });
    (rule.requiredApproverTeams ?? []).forEach((teamId) => {
      if (!validTeams.has(teamId)) {
        throw new Error(`${teamId} is not a valid team ID.`);
      }
    });
  });
}
