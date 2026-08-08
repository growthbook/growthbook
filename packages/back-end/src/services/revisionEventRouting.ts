import { serveFootprint } from "shared/permissions";
import { Revision } from "shared/enterprise";
import { Context } from "back-end/src/models/BaseModel";
import { getEnvironments } from "back-end/src/services/organizations";
import { revisionEventProjects } from "back-end/src/events/revisionWebhookAdapters";

type RoutableEntity = { project?: string; projects?: string[] };

/**
 * Where a revision event is delivered: the projects and environments a subscription
 * is filtered on.
 *
 * `[]` means "affects nothing" to the delivery filter, so the same trap the
 * permission layer has applies here — a change felt in every environment while
 * naming none would reach no environment-filtered subscriber. Whether a type
 * partitions by environment is therefore something the caller states:
 *
 *  - Omit `scopedFor` — no environment dimension (Saved Groups); `[]` is honest.
 *  - Provide it — an empty result means "felt everywhere that entity serves".
 *
 * Resolved over snapshot ∪ live, the same union `projects` takes: a draft opened
 * before a move names the old project, and a Config's scoped set can move on the
 * live entity. Routing on either alone loses the subscribers on the other side.
 */
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
