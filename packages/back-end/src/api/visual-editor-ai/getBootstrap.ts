import { z } from "zod";
import type { ExperimentInterface } from "shared/types/experiment";
import type { VisualChangesetInterface } from "shared/types/visual-changeset";
import {
  findVisualChangesets,
  findVisualChangesetsByExperimentIds,
} from "back-end/src/models/VisualChangesetModel";
import {
  findVisualExperimentsByName,
  getExperimentsByIds,
} from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { logger } from "back-end/src/util/logger";
import { requireUserAuth } from "./requireUserAuth";

// Bootstrap data for the side panel's empty + switcher states: the user's
// projects plus a capped recent-visual-experiments list.
const validation = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      search: z.string().max(100).optional(),
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z.any(),
  method: "get" as const,
  path: "/visual-editor/bootstrap",
  operationId: "getVisualEditorBootstrap",
  // Internal Visual Editor extension endpoint
  excludeFromSpec: true,
};

// One row per changeset (a multi-changeset experiment contributes
// multiple rows), capped at 30.
const MAX_RECENT = 30;

// Changesets have no timestamp of their own, so we fetch the N
// most-recently-created and rank them in memory by their experiment's
// dateUpdated. Orgs above this cap get approximate ranking — a changeset
// created long ago whose experiment was updated yesterday may fall outside
// the candidate window.
const CANDIDATE_CHANGESET_CAP = 200;

// Max experiments a name search resolves (most-recently-updated first). The
// final list is still ranked + trimmed to MAX_RECENT afterward.
const SEARCH_EXPERIMENT_CAP = 100;

export const getBootstrap = createApiRequestHandler(validation)(async (req) => {
  const context = req.context;
  requireUserAuth(context);

  const projects = await context.models.projects.getAll();

  // Non-archived hashable attributes only. We intentionally do NOT fall
  // back to a synthetic `id` when empty — the side panel surfaces a
  // "configure a hashable attribute first" message instead.
  const hashAttributes = (context.org.settings?.attributeSchema ?? [])
    .filter((a) => a.hashAttribute && !a.archived)
    .map((a) => ({
      property: a.property,
      ...(a.description ? { description: a.description } : {}),
    }));

  // Search mode queries VISUAL experiments by name directly, then fetches
  // THEIR changesets — so a target outside the newest-changeset window is
  // still reachable.
  const search = (req.query.search ?? "").trim();
  let changesets: VisualChangesetInterface[];
  let experiments: ExperimentInterface[];
  if (search) {
    experiments = await findVisualExperimentsByName(
      context,
      search,
      SEARCH_EXPERIMENT_CAP,
    );

    changesets = await findVisualChangesetsByExperimentIds(
      experiments.map((e) => e.id),
      req.organization.id,
      CANDIDATE_CHANGESET_CAP,
    );
  } else {
    // `findVisualChangesets` returns newest-`_id`-first; we rely on that
    // as the tiebreaker after the dateUpdated sort below.
    changesets = await findVisualChangesets(
      req.organization.id,
      CANDIDATE_CHANGESET_CAP,
    );
    const expIds = Array.from(new Set(changesets.map((cs) => cs.experiment)));
    experiments = await getExperimentsByIds(context, expIds);
  }
  const experimentById = new Map(experiments.map((e) => [e.id, e]));

  // dateUpdated / dateCreated arrive as Date from Mongoose but may be
  // strings in some serialization paths.
  const toIso = (d: unknown): string => {
    if (d instanceof Date) return d.toISOString();
    if (typeof d === "string") return d;
    return new Date(0).toISOString();
  };

  const recentExperiments: Array<{
    experimentId: string;
    experimentName: string;
    visualChangesetId: string;
    primaryUrl: string | null;
    extraPatternCount: number;
    // Full list so the side panel can match against the active tab URL
    // and surface "on this page" changesets first.
    urlPatterns: Array<{
      include: boolean;
      type: "simple" | "regex";
      pattern: string;
    }>;
    project: string | null;
    status: string;
    updatedAt: string;
  }> = [];
  for (const cs of changesets) {
    const exp = experimentById.get(cs.experiment);
    // Skip changesets whose experiment we can't read (deleted or no
    // permission) — an orphan row the user can't open is a dead end.
    if (!exp) continue;
    const patterns = cs.urlPatterns ?? [];
    // Prefer the first include rule as the "where it runs" label.
    const includes = patterns.filter((p) => p.include);
    const primary = includes[0] ?? patterns[0] ?? null;
    recentExperiments.push({
      experimentId: exp.id,
      experimentName: exp.name,
      visualChangesetId: cs.id,
      primaryUrl: primary?.pattern ?? null,
      extraPatternCount: Math.max(0, patterns.length - 1),
      urlPatterns: patterns,
      project: exp.project || null,
      status: exp.status,
      updatedAt: toIso(exp.dateUpdated ?? exp.dateCreated),
    });
  }
  // Default (non-search) list: draft experiments first (they're the ones you
  // can edit), then by most-recently-updated within each group. Sorting drafts
  // ahead of the trim means they win the MAX_RECENT slots over older
  // running/stopped ones.
  const statusRank = (s: string) => (s === "draft" ? 0 : 1);
  recentExperiments.sort((a, b) => {
    if (!search) {
      const byStatus = statusRank(a.status) - statusRank(b.status);
      if (byStatus !== 0) return byStatus;
    }
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  const trimmed = recentExperiments.slice(0, MAX_RECENT);

  logger.debug(
    {
      orgId: req.organization.id,
      projectsCount: projects.length,
      changesetCount: changesets.length,
      searchMode: search.length > 0,
      experimentsFetched: experiments.length,
      returnedRecent: trimmed.length,
    },
    "[visual-editor-ai/bootstrap] response counts",
  );

  return {
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
    })),
    hashAttributes,
    recentExperiments: trimmed,
  };
});
