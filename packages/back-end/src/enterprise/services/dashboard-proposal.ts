import {
  BlockComparison,
  BlockLayout,
  BlockToPack,
  buildComparisonExplorationConfig,
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  DashboardBlockSizeHint,
  DashboardDraftOf,
  DroppedDashboardBlock,
  getEffectiveExplorationConfig,
  packDashboardBlocks,
  ProposeDashboardBlock,
  proposedBlockNeedsExploration,
  resolveBlockComparison,
  resolveComparisonPreviousTimeFrame,
} from "shared/enterprise";
import type { ReqContext } from "back-end/types/request";
import { runProductAnalyticsExploration } from "back-end/src/enterprise/services/product-analytics";
import { logger } from "back-end/src/util/logger";

// Runs each proposed chart for its analysis id, then packs the grid — the agent
// threading N ids back is the step most likely to go wrong.

/** Ids optional: a loaded dashboard keeps the ones it has, a new block gets them on save. */
type DraftBlock = DashboardBlockInterfaceOrData<DashboardBlockInterface>;

export type DashboardDraft = DashboardDraftOf<DraftBlock>;

type DashboardDraftMeta = Omit<DashboardDraftOf<unknown>, "blocks" | "title">;

/** Blocks to propose, or a `dashboardId` to load as-is. */
export type BuildDashboardDraftInput = DashboardDraftMeta &
  (
    | { title: string; blocks: ProposeDashboardBlock[] }
    | { dashboardId: string; title?: string; blocks?: undefined }
  );

export interface BuildDashboardDraftResult {
  draft: DashboardDraft;
  droppedBlocks: DroppedDashboardBlock[];
  /** Set when no draft could be built at all; the tool reports it verbatim. */
  error?: string;
}

/** Narrowed to what `getEffectiveExplorationConfig` reads; a proposal has no ids. */
type EffectiveConfigInput = Parameters<typeof getEffectiveExplorationConfig>[0];

// Queries the *effective* config, not the raw one, or every tile renders stale.
// Does not wait for the warehouse; the tile polls, as on a saved dashboard.
async function runBlockExplorations(
  context: ReqContext,
  blockType: string,
  config: EffectiveConfigInput["config"],
  comparison: BlockComparison | undefined,
): Promise<{
  explorerAnalysisId: string;
  comparisonExplorerAnalysisId?: string;
} | null> {
  try {
    // Never cached: a fuzzy hit stores a dateRange the tile reads as stale.
    const exploration = await runProductAnalyticsExploration(context, config, {
      cache: "never",
    });
    if (!exploration?.id) return null;

    if (!comparison?.enabled) {
      return { explorerAnalysisId: exploration.id };
    }

    // A failed comparison must not cost the user the primary tile.
    try {
      const previous = await runProductAnalyticsExploration(
        context,
        buildComparisonExplorationConfig(
          config,
          resolveComparisonPreviousTimeFrame(config.dateRange, comparison),
        ),
        // Same reason; the tile reads the previous window off this analysis.
        { cache: "never" },
      );
      return {
        explorerAnalysisId: exploration.id,
        ...(previous?.id ? { comparisonExplorerAnalysisId: previous.id } : {}),
      };
    } catch (err) {
      logger.warn(
        { err, blockType },
        "dashboard proposal: comparison exploration failed",
      );
      return { explorerAnalysisId: exploration.id };
    }
  } catch (err) {
    logger.warn({ err, blockType }, "dashboard proposal: exploration failed");
    return null;
  }
}

const noDraft = (error: string): BuildDashboardDraftResult => ({
  draft: { title: "", blocks: [] },
  droppedBlocks: [],
  error,
});

/** Blocks verbatim — ids, layout, analysis ids — so nothing re-packs and nothing re-queries. */
async function loadSavedDashboardDraft(
  context: ReqContext,
  dashboardId: string,
  overrides: DashboardDraftMeta & { title?: string },
): Promise<BuildDashboardDraftResult> {
  const dashboard = await context.models.dashboards.getById(dashboardId);
  if (!dashboard) {
    return noDraft(
      `No dashboard with id "${dashboardId}" — check the id, or list dashboards to find it.`,
    );
  }
  if (dashboard.experimentId) {
    return noDraft(
      `"${dashboard.title}" belongs to an experiment, and experiment dashboards are edited on the experiment's own page.`,
    );
  }
  if (!dashboard.blocks.length) {
    return noDraft(
      `"${dashboard.title}" has no blocks yet, so there is nothing to show. Propose the blocks it should have instead.`,
    );
  }

  const globalControls = overrides.globalControls ?? dashboard.globalControls;
  const comparison = overrides.comparison ?? dashboard.comparison;
  return {
    draft: {
      dashboardId: dashboard.id,
      title: overrides.title ?? dashboard.title,
      // Always set: `[]` is "every project", not "fall back to the client default".
      projects: overrides.projects ?? dashboard.projects ?? [],
      ...(globalControls ? { globalControls } : {}),
      ...(comparison ? { comparison } : {}),
      blocks: dashboard.blocks,
    },
    droppedBlocks: [],
  };
}

/** Null for missing, unreadable, or unresolvable — the caller refuses either way. */
async function readRevisionBase(
  context: ReqContext,
  dashboardId: string,
): Promise<DashboardInterface | null> {
  try {
    return await context.models.dashboards.getById(dashboardId);
  } catch (err) {
    logger.warn(
      { err, dashboardId },
      "dashboard proposal: could not read the dashboard being revised",
    );
    return null;
  }
}

/** Pairs on type+title, the only stable key the model can send. Single-use per saved block. */
function createSavedBlockMatcher(saved: DashboardBlockInterface[]) {
  const unclaimed = [...saved];
  return (proposed: { type: string; title: string }) => {
    const i = unclaimed.findIndex(
      (b) => b.type === proposed.type && b.title === proposed.title,
    );
    return i === -1 ? undefined : unclaimed.splice(i, 1)[0];
  };
}

/** Carried blocks keep their coordinates; new ones pack below, so nothing overlaps. */
function packAroundCarriedLayout(
  entries: BlockToPack<DraftBlock>[],
): (DraftBlock & { layout: BlockLayout })[] {
  const bottoms = entries.map(({ block: { layout } }) =>
    layout ? layout.y + layout.h : null,
  );
  const carried = bottoms.filter((b): b is number => b !== null);
  if (!carried.length) return packDashboardBlocks(entries);

  const nextY = Math.max(...carried);
  const fresh = bottoms.flatMap((b, i) => (b === null ? [i] : []));
  const out = entries.map(
    (e) => e.block as DraftBlock & { layout: BlockLayout },
  );
  packDashboardBlocks(fresh.map((i) => entries[i])).forEach((block, j) => {
    out[fresh[j]] = {
      ...block,
      layout: { ...block.layout, y: block.layout.y + nextY },
    };
  });
  return out;
}

export async function buildDashboardDraft(
  context: ReqContext,
  input: BuildDashboardDraftInput,
): Promise<BuildDashboardDraftResult> {
  if (!input.blocks) {
    return loadSavedDashboardDraft(context, input.dashboardId, input);
  }

  const droppedBlocks: BuildDashboardDraftResult["droppedBlocks"] = [];

  // The stored blocks are the only record of the layout; the model cannot send one.
  // An id that resolves to nothing must not reach the draft: it binds the preview
  // to a dashboard that isn't there, so Save becomes Update against a 404.
  let saved: DashboardInterface | null = null;
  if (input.dashboardId) {
    saved = await readRevisionBase(context, input.dashboardId);
    if (!saved) {
      return noDraft(
        `No dashboard with id "${input.dashboardId}". Omit dashboardId to propose a new one, or list dashboards to find the right id.`,
      );
    }
  }
  const matchSaved = createSavedBlockMatcher(saved?.blocks ?? []);
  const revised = input.blocks.map(matchSaved);

  // Identity travels with the layout, or every edit churns the block's `uid`.
  const carriedFrom = (previous: DashboardBlockInterface | undefined) =>
    previous
      ? {
          id: previous.id,
          uid: previous.uid,
          organization: previous.organization,
          ...(previous.layout ? { layout: previous.layout } : {}),
        }
      : {};

  // Independent, so run them together rather than paying N round-trips.
  const built = await Promise.all(
    input.blocks.map(async (proposed, index) => {
      const { sizeHint, ...block } = proposed as ProposeDashboardBlock & {
        sizeHint?: DashboardBlockSizeHint;
      };
      const carried = carriedFrom(revised[index]);

      if (!proposedBlockNeedsExploration(proposed)) {
        return {
          block: { ...block, ...carried } as DraftBlock,
          sizeHint,
        };
      }

      // Enroll in the date control first, as a hand-built dashboard gets on
      // save — without it the filter bar is inert and Update skips this tile.
      const enrolled = {
        ...block,
        ...(input.globalControls?.dateRange
          ? { globalControlSettings: { dateRange: true } }
          : {}),
      };

      const config = input.globalControls
        ? getEffectiveExplorationConfig(enrolled as EffectiveConfigInput, {
            globalControls: input.globalControls,
          })
        : proposed.config;

      const ran = await runBlockExplorations(
        context,
        proposed.type,
        config,
        // Dashboard-wide wins over the block's own, both ways — the same
        // precedence the tiles apply, so we run the query they look for.
        resolveBlockComparison(proposed, {
          comparison: input.comparison,
        }) ?? undefined,
      );
      if (!ran) {
        const previous = revised[index];
        // Dropping a tile that already exists would PUT a block list without it,
        // deleting it for good. Keep the saved one, stale result and all.
        if (previous) {
          droppedBlocks.push({
            title: proposed.title,
            type: proposed.type,
            reason: "the query could not be re-run",
            kept: true,
          });
          return { block: previous as DraftBlock, sizeHint };
        }
        droppedBlocks.push({
          title: proposed.title,
          type: proposed.type,
          reason: "the query could not be started",
        });
        return null;
      }

      return {
        block: { ...enrolled, ...ran, ...carried } as DraftBlock,
        sizeHint,
      };
    }),
  );

  const packed = packAroundCarriedLayout(
    built.filter((b): b is NonNullable<typeof b> => b !== null),
  );

  return {
    draft: {
      ...(input.dashboardId ? { dashboardId: input.dashboardId } : {}),
      title: input.title,
      // Absent and `[]` ("every project") mean different things to the preview.
      ...(input.projects ? { projects: input.projects } : {}),
      ...(input.globalControls ? { globalControls: input.globalControls } : {}),
      ...(input.comparison ? { comparison: input.comparison } : {}),
      blocks: packed,
    },
    droppedBlocks,
  };
}
