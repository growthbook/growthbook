import { serveFootprint } from "shared/permissions";
import { Revision } from "shared/enterprise";
import { Context } from "back-end/src/models/BaseModel";
import { getEnvironments } from "back-end/src/services/organizations";
import { revisionEventProjects } from "back-end/src/events/revisionWebhookAdapters";

type RoutableEntity = { project?: string; projects?: string[] };

// Routes over snapshot ∪ live scope. Without scopedFor there is no environment
// dimension; an empty scoped result widens to serving scope.
export async function revisionEventRouting({
  context,
  revision,
  liveForRouting,
  scopedFor,
}: {
  context: Context;
  revision: Revision;
  liveForRouting: RoutableEntity | null;
  scopedFor?: (entity: RoutableEntity) => string[];
}): Promise<{ projects: string[]; environments: string[] }> {
  const projects = revisionEventProjects(revision, liveForRouting);
  if (!scopedFor) return { projects, environments: [] };

  const orgEnvironments = getEnvironments(context.org);
  const reachOf = (entity: RoutableEntity | null): string[] => {
    if (!entity) return [];
    const scoped = scopedFor(entity);
    return scoped.length ? scoped : serveFootprint(orgEnvironments, entity);
  };

  return {
    projects,
    environments: [
      ...new Set([
        ...reachOf(revision.target.snapshot as RoutableEntity),
        ...reachOf(liveForRouting),
      ]),
    ],
  };
}
