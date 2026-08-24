import {
  BlockComparison,
  buildComparisonExplorationConfig,
  CreateDashboardBlockInterface,
  DashboardGlobalControls,
  DashboardBlockSizeHint,
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

/**
 * Turn an agent's proposed dashboard into a concrete, renderable draft.
 *
 * The model describes blocks; this fills in everything it cannot know — it runs
 * each chart to get the analysis id the block renders from, and packs the grid.
 * Doing it here rather than making the agent run N explorations and thread N ids
 * back is the whole point: threading ids is the step most likely to go wrong,
 * and every intermediate run would otherwise surface as its own chart card in
 * the chat.
 */

export interface DashboardDraft {
  /** Set when revising a dashboard that already exists; absent for a new one. */
  dashboardId?: string;
  title: string;
  /**
   * Project ids the dashboard belongs to; `[]` is every project. Absent when
   * the agent could not establish it, in which case the preview falls back to
   * whatever project the user has selected in the app.
   */
  projects?: string[];
  globalControls?: DashboardGlobalControls;
  /** Dashboard-wide compare-to-previous-period; overrides any per-block setting. */
  comparison?: BlockComparison;
  blocks: CreateDashboardBlockInterface[];
}

export interface BuildDashboardDraftInput {
  dashboardId?: string;
  title: string;
  projects?: string[];
  globalControls?: DashboardGlobalControls;
  comparison?: BlockComparison;
  blocks: ProposeDashboardBlock[];
}

export interface BuildDashboardDraftResult {
  draft: DashboardDraft;
  /** Blocks that could not be built, and why — surfaced to the model and user. */
  droppedBlocks: { title: string; type: string; reason: string }[];
}

/**
 * The block shape `getEffectiveExplorationConfig` reads: it only looks at
 * `config` and `globalControlSettings`, but its parameter is typed as a stored
 * block. A proposal has neither ids nor an analysis id yet, so this narrows to
 * what the function actually touches rather than inventing placeholder ids.
 */
type EffectiveConfigInput = Parameters<typeof getEffectiveExplorationConfig>[0];

/**
 * Kick off the explorations behind one chart block and return their ids.
 *
 * Two things here are load-bearing for the tile actually rendering:
 *
 * - It queries the *effective* config — the block's own config with the
 *   dashboard's date control applied — because the tile recomputes that same
 *   effective config on render and compares its date fingerprint against what
 *   was queried. Querying the raw config instead leaves every tile showing
 *   "Global controls changed, click Update" on a dashboard nobody has touched.
 * - It runs the previous-period exploration too when the block compares, since
 *   that is a separate entity; without it a "vs prior period" tile renders
 *   primary-only.
 *
 * Deliberately does not wait for the warehouse: a block whose exploration is
 * still running renders a loading tile and polls itself, exactly as on a saved
 * dashboard. Waiting would only make the tool call slower.
 */
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
    const exploration = await runProductAnalyticsExploration(context, config, {
      cache: "preferred",
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
        { cache: "preferred" },
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

export async function buildDashboardDraft(
  context: ReqContext,
  input: BuildDashboardDraftInput,
): Promise<BuildDashboardDraftResult> {
  const droppedBlocks: BuildDashboardDraftResult["droppedBlocks"] = [];

  // Explorations are independent, so run them together rather than serially —
  // a six-tile dashboard would otherwise pay six round-trips end to end.
  const built = await Promise.all(
    input.blocks.map(async (proposed) => {
      const { sizeHint, ...block } = proposed as ProposeDashboardBlock & {
        sizeHint?: DashboardBlockSizeHint;
      };

      if (!proposedBlockNeedsExploration(proposed)) {
        return {
          block: block as CreateDashboardBlockInterface,
          sizeHint,
        };
      }

      // Enroll in the dashboard's date control first, matching the
      // auto-enrollment a hand-built dashboard gets on save. Without it the
      // filter bar is inert for this tile and Update skips it entirely — and
      // the effective config below would come back unchanged.
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
        // The dashboard-wide setting wins over the block's own, in both
        // directions — the same precedence the tiles apply when rendering, so
        // the previous-period query we run is the one they look for.
        resolveBlockComparison(proposed, {
          comparison: input.comparison,
        }) ?? undefined,
      );
      if (!ran) {
        droppedBlocks.push({
          title: proposed.title,
          type: proposed.type,
          reason: "the query could not be started",
        });
        return null;
      }

      return {
        block: { ...enrolled, ...ran } as CreateDashboardBlockInterface,
        sizeHint,
      };
    }),
  );

  const packed = packDashboardBlocks(
    built.filter((b): b is NonNullable<typeof b> => b !== null),
  );

  return {
    draft: {
      ...(input.dashboardId ? { dashboardId: input.dashboardId } : {}),
      title: input.title,
      // Passed through rather than defaulted: an absent value and an explicit
      // `[]` ("every project") mean different things to the preview.
      ...(input.projects ? { projects: input.projects } : {}),
      ...(input.globalControls ? { globalControls: input.globalControls } : {}),
      ...(input.comparison ? { comparison: input.comparison } : {}),
      blocks: packed,
    },
    droppedBlocks,
  };
}
