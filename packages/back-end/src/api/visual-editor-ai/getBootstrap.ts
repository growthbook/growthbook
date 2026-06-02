import { z } from "zod";
import { findVisualChangesets } from "back-end/src/models/VisualChangesetModel";
import { getExperimentsByIds } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { logger } from "back-end/src/util/logger";
import { requireUserAuth } from "./requireUserAuth";

// Bootstrap data for the side panel's empty + switcher states. Returns
// the user's projects (for the create-experiment project selector) plus
// a small recent-visual-experiments list (for the "switch experiment"
// dropdown next to the experiment name).
//
// The list is intentionally capped — the dropdown isn't meant to be a
// full search UI; users with hundreds of experiments will still use the
// GrowthBook web app to find a specific one. We surface the most-recent
// 20 visual changesets keyed by their owning experiment.
const validation = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.any(),
  method: "get" as const,
  path: "/visual-editor/bootstrap",
  operationId: "getVisualEditorBootstrap",
};

// Caps the number of CHANGESETS returned (one row per changeset — an
// experiment with several URL-scoped changesets contributes several
// rows). Slightly higher than the old experiment-level cap so a handful
// of multi-changeset experiments don't crowd everything else out.
const MAX_RECENT = 30;

// Upper bound on how many changesets we pull from the DB before ranking.
// We can't sort/limit by the experiment's dateUpdated at the changeset-
// query layer (changesets carry no timestamp and live in a separate
// collection), so instead we fetch the N most-recently-CREATED changesets
// and then rank those by their experiment's dateUpdated in memory. For the
// overwhelming majority of orgs (far fewer than 200 visual experiments)
// this fetches everything and the ranking is exact. For orgs above the cap
// it's an approximation: a changeset created long ago whose experiment was
// updated yesterday could fall outside the candidate window. Acceptable
// for a "jump back to recent work" dropdown, and it bounds what was
// previously an unbounded org-wide fetch of every changeset + experiment.
const CANDIDATE_CHANGESET_CAP = 200;

export const getBootstrap = createApiRequestHandler(validation)(async (req) => {
  const context = req.context;
  // Require PAT auth at the entry point so the extension fails fast
  // with a clear error on first open, rather than letting the user
  // browse projects + recents and then refusing at create-experiment.
  requireUserAuth(context);

  // Projects the caller can see. The side panel filters by what the user
  // can actually create against, but we send the full readable set so the
  // dropdown is consistent with the rest of GrowthBook.
  const projects = await context.models.projects.getAll();

  // Hashable identifier attributes from the org's SDK attribute schema —
  // surfaced so the create-experiment form can offer an explicit picker
  // instead of hardcoding "id" on the server. Filtered to non-archived
  // attributes flagged `hashAttribute: true`. We do NOT fall back to a
  // synthetic [{ property: "id" }] when the list is empty: the side
  // panel detects the empty case and surfaces a clear "configure a
  // hashable attribute first" message, which is better UX than silently
  // letting the user create an experiment with a hash attribute that
  // their SDK isn't passing.
  const hashAttributes = (context.org.settings?.attributeSchema ?? [])
    .filter((a) => a.hashAttribute && !a.archived)
    .map((a) => ({
      property: a.property,
      ...(a.description ? { description: a.description } : {}),
    }));

  // The most-recently-created visual changesets for the org, capped at
  // CANDIDATE_CHANGESET_CAP. VisualChangesetInterface doesn't expose
  // timestamps, so we use the *experiment's* dateUpdated as the recency
  // signal for the final ranking below. `findVisualChangesets` returns
  // newest-`_id`-first (creation order), which we lean on as the
  // secondary sort key below.
  const changesets = await findVisualChangesets(
    req.organization.id,
    CANDIDATE_CHANGESET_CAP,
  );

  // Look up the owning experiments once. An experiment can own MORE THAN
  // ONE changeset (one per URL target), so we emit a row per changeset —
  // NOT per experiment — and share the experiment metadata across its
  // changesets via this map.
  const expIds = Array.from(new Set(changesets.map((cs) => cs.experiment)));
  const experiments = await getExperimentsByIds(context, expIds);
  const experimentById = new Map(experiments.map((e) => [e.id, e]));

  // Defensively coerce updatedAt: dateUpdated / dateCreated come back as
  // Date objects from Mongoose, but in some serialization paths they
  // arrive as strings. Either is fine, we just want a comparable
  // ISO-ish string for the sort. Throwing here would cause the whole
  // bootstrap call to 500 and leave the dropdown stuck on "Loading…".
  const toIso = (d: unknown): string => {
    if (d instanceof Date) return d.toISOString();
    if (typeof d === "string") return d;
    return new Date(0).toISOString();
  };

  const recentExperiments: Array<{
    experimentId: string;
    experimentName: string;
    visualChangesetId: string;
    // First include pattern + a count of remaining patterns. We expose
    // a single primary URL for the dropdown's compact label and the
    // full list as a count badge — drilling into all patterns means
    // jumping to the GrowthBook web app.
    primaryUrl: string | null;
    extraPatternCount: number;
    // Full pattern list. Sent so the side panel can evaluate each
    // changeset against the active tab URL (using the same SDK matching
    // logic) and surface "on this page" changesets first. Trivially
    // small payload — most changesets have 1-3 patterns.
    urlPatterns: Array<{
      include: boolean;
      type: "simple" | "regex";
      pattern: string;
    }>;
    project: string | null;
    status: string;
    updatedAt: string;
  }> = [];
  // One row per changeset. We iterate `changesets` in their incoming
  // newest-created-first order; the stable sort below preserves that as
  // the tiebreaker within an experiment group.
  for (const cs of changesets) {
    const exp = experimentById.get(cs.experiment);
    // Skip changesets whose experiment we couldn't read (deleted, or no
    // read permission) — surfacing an orphan row the user can't open
    // would just be a dead end.
    if (!exp) continue;
    const patterns = cs.urlPatterns ?? [];
    // Prefer the first include rule — that's the "where it runs" we
    // want users to see. Excludes are usually a small-scope filter
    // and aren't useful as the primary label.
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
  // Sort by experiment recency DESC. Array.prototype.sort is stable
  // (ES2019+), so changesets sharing an experiment keep their incoming
  // newest-created-first order and stay ADJACENT — which is exactly what
  // the side panel's switcher relies on to group a multi-changeset
  // experiment's rows together under one name.
  recentExperiments.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const trimmed = recentExperiments.slice(0, MAX_RECENT);

  // debug, not info: this is a high-frequency endpoint (fires whenever
  // the side panel opens the switcher / create form), so logging at
  // info would spam production logs. The counts are diagnostic-only.
  logger.debug(
    {
      orgId: req.organization.id,
      projectsCount: projects.length,
      changesetCount: changesets.length,
      expIdsCount: expIds.length,
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
