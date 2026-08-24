import { z } from "zod";
import {
  dateGranularity,
  baseExplorationConfigValidator,
} from "../../validators/product-analytics";
import { namedSchema } from "../../validators/openapi-helpers";

import {
  apiCreateDashboardBlockInterface,
  apiDashboardBlockInterface,
  blockComparisonValidator,
  dashboardBlockInterface,
  DASHBOARD_GRID_COLS,
} from "./dashboard-block";

export const dashboardEditLevel = z.enum(["published", "private"]);
export const dashboardShareLevel = z.enum(["published", "private"]);
export const dashboardUpdateSchedule = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("stale"),
      hours: z.number(),
    })
    .strict(),
  z
    .object({
      type: z.literal("cron"),
      cron: z.string(),
    })
    .strict(),
]);

export const DASHBOARD_GRID_ROW_HEIGHT_DEFAULT = 40;
export const dashboardGridConfig = z
  .object({
    cols: z
      .number()
      .int()
      .min(1)
      .max(DASHBOARD_GRID_COLS)
      .default(DASHBOARD_GRID_COLS),
    rowHeight: z
      .number()
      .int()
      .min(8)
      .default(DASHBOARD_GRID_ROW_HEIGHT_DEFAULT),
  })
  .strict();
export type DashboardGridConfig = z.infer<typeof dashboardGridConfig>;

export const dashboardGlobalControlsValidator = z
  .object({
    dateRange: baseExplorationConfigValidator.shape.dateRange.optional(),
    dateGranularity: z.enum(dateGranularity).optional(),
    // Experiment-block filters, applied per-block via globalControlSettings.
    // `projects: []` means all projects; absent means no dashboard-wide filter.
    projects: z.array(z.string()).optional(),
    experimentSearchString: z.string().optional(),
  })
  .strict();
export type DashboardGlobalControls = z.infer<
  typeof dashboardGlobalControlsValidator
>;

export const dashboardInterface = z
  .object({
    id: z.string(),
    uid: z.string(), // Enables sharing/linking to dashboards in future
    organization: z.string(),
    experimentId: z.string().optional(), // If an empty string, it's a general dashboard
    isDefault: z.boolean(), // Deprecated
    isDeleted: z.boolean(), // For soft-deletes (currently unused)
    userId: z.string(),
    editLevel: dashboardEditLevel,
    shareLevel: dashboardShareLevel, // Only configurable for orgs with share-product-analytics-dashboards commercialFeature (PA) or dashboards commercialFeature (Exp)
    enableAutoUpdates: z.boolean(),
    updateSchedule: dashboardUpdateSchedule.optional(),
    title: z.string(),
    blocks: z.array(dashboardBlockInterface),
    globalControls: dashboardGlobalControlsValidator.optional(),
    // Dashboard-wide period comparison, set from the dashboard date controls.
    // Takes precedence over a block's own setting (see resolveBlockComparison)
    // and is honored on refresh and render.
    comparison: blockComparisonValidator.optional(),
    grid: dashboardGridConfig.optional(),
    projects: z.array(z.string()).optional(), // General dashboards only, experiment dashboards use the experiment's projects
    nextUpdate: z.date().optional(),
    lastUpdated: z.date().optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

export const apiDashboardInterface = namedSchema(
  "Dashboard",
  dashboardInterface
    .omit({
      nextUpdate: true,
      lastUpdated: true,
      dateCreated: true,
      dateUpdated: true,
      blocks: true,
    })
    .safeExtend({
      nextUpdate: z.iso.datetime().optional(),
      lastUpdated: z.iso.datetime().optional(),
      dateCreated: z.iso.datetime(),
      dateUpdated: z.iso.datetime(),
      blocks: z.array(apiDashboardBlockInterface),
    }),
);

export const apiCreateDashboardBody = z
  .object({
    title: z.string().describe("The display name of the Dashboard"),
    editLevel: z
      .enum(["published", "private"])
      .describe(
        'Dashboards that are "published" are editable by organization members with appropriate permissions',
      ),
    shareLevel: z
      .enum(["published", "private"])
      .describe(
        'General Dashboards only. Dashboards that are "published" are viewable by organization members with appropriate permissions',
      ),
    enableAutoUpdates: z
      .boolean()
      .describe(
        "If enabled for a General Dashboard, also requires an updateSchedule",
      ),
    updateSchedule: z
      .union([
        z.strictObject({ type: z.literal("stale"), hours: z.number() }),
        z.strictObject({ type: z.literal("cron"), cron: z.string() }),
      ])
      .describe(
        "General Dashboards only. Experiment Dashboards update based on the parent experiment instead",
      )
      .optional(),
    experimentId: z
      .string()
      .describe(
        "The parent experiment for an Experiment Dashboard, or undefined for a general dashboard",
      )
      .optional(),
    projects: z
      .array(z.string())
      .describe(
        "General Dashboards only, Experiment Dashboards use the experiment's projects",
      )
      .optional(),
    globalControls: dashboardGlobalControlsValidator.optional(),
    blocks: z.array(apiCreateDashboardBlockInterface),
  })
  .strict();

export const apiUpdateDashboardBody = apiCreateDashboardBody
  .omit({ experimentId: true, blocks: true })
  .extend({
    blocks: z.array(
      z.union([apiCreateDashboardBlockInterface, apiDashboardBlockInterface]),
    ),
  })
  .partial();

export const apiGetDashboardsForExperimentValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.strictObject({ experimentId: z.string() }),
};
export const apiGetDashboardsForExperimentReturn = z.strictObject({
  dashboards: z.array(apiDashboardInterface),
});
export type ApiGetDashboardsForExperimentReturn = z.infer<
  typeof apiGetDashboardsForExperimentReturn
>;
export type DashboardInterface = z.infer<typeof dashboardInterface>;
export type ApiDashboardInterface = z.infer<typeof apiDashboardInterface>;

export type DashboardEditLevel = z.infer<typeof dashboardEditLevel>;
export type DashboardShareLevel = z.infer<typeof dashboardShareLevel>;
export type DashboardUpdateSchedule = z.infer<typeof dashboardUpdateSchedule>;

// ---------------------------------------------------------------------------
// AI-proposed dashboards
//
// The `proposeDashboard` tool result: the draft the server built from the
// model's proposal, plus whatever it could not build. Declared here rather than
// once per package because the back-end writes it into a tool result and the
// chat UI reads it back out — two declarations of one wire shape drift the
// moment either side gains a field.
//
// `blocks` stays `unknown[]`: the server has already produced them from
// `proposeDashboardBlockValidator`, and re-validating the full block union on
// the way into the preview would only add a way for a valid dashboard to render
// as nothing. Each side casts to the block type it works in.
// ---------------------------------------------------------------------------

export const droppedDashboardBlockValidator = z.object({
  title: z.string(),
  type: z.string(),
  reason: z.string(),
});

export const dashboardDraftValidator = z.object({
  /** Set when revising a dashboard that already exists; absent for a new one. */
  dashboardId: z.string().optional(),
  title: z.string().min(1),
  /**
   * Project ids the dashboard belongs to; `[]` is every project. Absent when the
   * agent could not establish it, in which case the preview falls back to
   * whatever project the user has selected — so an empty array and a missing
   * value mean different things and neither is defaulted away.
   */
  projects: z.array(z.string()).optional(),
  globalControls: dashboardGlobalControlsValidator.optional(),
  /** Dashboard-wide compare-to-previous-period; overrides any per-block setting. */
  comparison: blockComparisonValidator.optional(),
  blocks: z.array(z.unknown()).min(1),
});

export const proposeDashboardResultValidator = z.object({
  draft: dashboardDraftValidator,
  /** Blocks that could not be built, and why — surfaced to the model and user. */
  droppedBlocks: z.array(droppedDashboardBlockValidator).catch([]),
});

export type DroppedDashboardBlock = z.infer<
  typeof droppedDashboardBlockValidator
>;

/** A draft carrying the block type the reading side works in. */
export type DashboardDraftOf<Block> = Omit<
  z.infer<typeof dashboardDraftValidator>,
  "blocks"
> & { blocks: Block[] };
