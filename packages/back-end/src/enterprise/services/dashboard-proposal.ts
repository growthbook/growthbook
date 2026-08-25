import {
  BlockComparison,
  buildComparisonExplorationConfig,
  CreateDashboardBlockInterface,
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

/** What the tool result carries: blocks the dashboards API can be handed. */
export type DashboardDraft = DashboardDraftOf<CreateDashboardBlockInterface>;

/** The same shape the model proposed, before the server ran anything. */
export type BuildDashboardDraftInput = DashboardDraftOf<ProposeDashboardBlock>;

export interface BuildDashboardDraftResult {
  draft: DashboardDraft;
  droppedBlocks: DroppedDashboardBlock[];
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

export async function buildDashboardDraft(
  context: ReqContext,
  input: BuildDashboardDraftInput,
): Promise<BuildDashboardDraftResult> {
  const droppedBlocks: BuildDashboardDraftResult["droppedBlocks"] = [];

  // Independent, so run them together rather than paying N round-trips.
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
      // Absent and `[]` ("every project") mean different things to the preview.
      ...(input.projects ? { projects: input.projects } : {}),
      ...(input.globalControls ? { globalControls: input.globalControls } : {}),
      ...(input.comparison ? { comparison: input.comparison } : {}),
      blocks: packed,
    },
    droppedBlocks,
  };
}
