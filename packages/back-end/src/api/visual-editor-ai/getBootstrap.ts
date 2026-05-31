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

const MAX_RECENT = 20;

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

  // The most-recently-created visual changesets for the org, capped at
  // CANDIDATE_CHANGESET_CAP. VisualChangesetInterface doesn't expose
  // timestamps, so we use the *experiment's* dateUpdated as the recency
  // signal for the final ranking below — that's also what the user
  // thinks of when they say "most recent experiment." One changeset per
  // experiment is the common case; when multiple exist we still surface
  // one entry per experiment. The cap bounds the fetch (see the constant
  // comment for the approximation trade-off it introduces above the cap).
  const changesets = await findVisualChangesets(
    req.organization.id,
    CANDIDATE_CHANGESET_CAP,
  );
  // We need both the changeset id (for switcher navigation) and its
  // URL patterns (for display in the switcher list — users want to
  // see at a glance which page each experiment targets). One entry
  // per experiment; first-seen wins for the multi-changeset case.
  const changesetByExperiment = new Map<
    string,
    {
      id: string;
      urlPatterns: Array<{
        include: boolean;
        type: "simple" | "regex";
        pattern: string;
      }>;
    }
  >();
  for (const cs of changesets) {
    if (!changesetByExperiment.has(cs.experiment)) {
      changesetByExperiment.set(cs.experiment, {
        id: cs.id,
        urlPatterns: cs.urlPatterns ?? [],
      });
    }
  }

  const expIds = Array.from(changesetByExperiment.keys());
  const experiments = await getExperimentsByIds(context, expIds);

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
    // experiment against the active tab URL (using the same SDK
    // matching logic) and surface "on this page" experiments first.
    // Trivially small payload — most changesets have 1-3 patterns.
    urlPatterns: Array<{
      include: boolean;
      type: "simple" | "regex";
      pattern: string;
    }>;
    project: string | null;
    status: string;
    updatedAt: string;
  }> = [];
  for (const exp of experiments) {
    const cs = changesetByExperiment.get(exp.id);
    if (!cs) continue;
    // Prefer the first include rule — that's the "where it runs" we
    // want users to see. Excludes are usually a small-scope filter
    // and aren't useful as the primary label.
    const includes = cs.urlPatterns.filter((p) => p.include);
    const primary = includes[0] ?? cs.urlPatterns[0] ?? null;
    recentExperiments.push({
      experimentId: exp.id,
      experimentName: exp.name,
      visualChangesetId: cs.id,
      primaryUrl: primary?.pattern ?? null,
      extraPatternCount: Math.max(0, cs.urlPatterns.length - 1),
      urlPatterns: cs.urlPatterns,
      project: exp.project || null,
      status: exp.status,
      updatedAt: toIso(exp.dateUpdated ?? exp.dateCreated),
    });
  }
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
    recentExperiments: trimmed,
  };
});
