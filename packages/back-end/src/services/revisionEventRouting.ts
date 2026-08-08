import { serveFootprint } from "shared/permissions";
import { Revision } from "shared/enterprise";
import { Context } from "back-end/src/models/BaseModel";
import { getEnvironments } from "back-end/src/services/organizations";
import { revisionEventProjects } from "back-end/src/events/revisionWebhookAdapters";

type RoutableEntity = { project?: string; projects?: string[] };

/**
 * Where a revision event is delivered: the projects and environments a
 * subscription is filtered on.
 *
 * Each entity type's dispatcher computed this itself, and the copies had drifted.
 * They also each re-derived the same trap the permission layer has: `[]` means
 * "affects nothing" to the delivery filter, so a change that names no environment
 * but is felt in all of them reached no environment-filtered subscriber at all —
 * precisely the widest-reaching changes (a base value, an archive) going
 * unannounced.
 *
 * The distinction is only knowable from whether the entity type partitions by
 * environment, so that is what a caller states:
 *
 *  - Omit `scopedFor` — this type has no environment dimension (Saved Groups), so
 *    `[]` is the honest answer and every environment-filtered subscription hears it.
 *  - Provide it — this type partitions, and an empty result for an entity means
 *    "felt everywhere that entity serves", never "felt nowhere".
 *
 * Resolved over snapshot ∪ live, the same union `projects` takes: a draft opened
 * before the entity moved names the current project in neither its snapshot nor its
 * ops, and a Config's scoped set can move on the live entity while the draft still
 * names the old one. Routing on either alone loses the subscribers on the other
 * side.
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
