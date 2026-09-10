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

/** A GET response is a superset of what a write accepts; drop the extra rather than reject it. */
function withoutKeys(raw: unknown, keys: readonly string[]): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const copy = { ...(raw as Record<string, unknown>) };
  for (const key of keys) {
    delete copy[key];
  }
  return copy;
}

/** Every block on a create is new, so none of them may carry server-owned keys. */
const apiCreateDashboardBlock = z.preprocess(
  (raw) => withoutKeys(raw, ["id", "uid", "organization"]),
  apiCreateDashboardBlockInterface,
);

/**
 * `{ "id": "dshblk_…" }` carries a saved block through untouched. An update
 * replaces the whole list, and re-sending tiles verbatim just to keep them is a
 * transcription job — write out only the blocks you are actually changing.
 */
export const dashboardBlockRef = z.strictObject({ id: z.string().min(1) });
export type DashboardBlockRef = z.infer<typeof dashboardBlockRef>;

export function isDashboardBlockRef(
  block: unknown,
): block is DashboardBlockRef {
  return dashboardBlockRef.safeParse(block).success;
}

/** An `id` marks a block the dashboard already has; only a new one gets stripped. */
const apiUpdateDashboardBlock = z.preprocess(
  (raw) => {
    const id = (raw as { id?: unknown } | null)?.id;
    if (typeof id === "string" && id) return raw;
    return withoutKeys(raw, ["uid", "organization"]);
  },
  // Ref first: it is strict, so a full block falls through to the shapes below.
  z.union([
    dashboardBlockRef,
    apiCreateDashboardBlockInterface,
    apiDashboardBlockInterface,
  ]),
);

const apiCreateDashboardFields = z
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
    comparison: blockComparisonValidator
      .optional()
      .describe(
        "Dashboard-wide compare-to-previous-period. Takes precedence over any " +
          "per-block comparison.",
      ),
    blocks: z.array(apiCreateDashboardBlock),
  })
  .strict();

/** Everything a GET returns that a write cannot set — derived, so a new field can't be missed. */
const READ_ONLY_DASHBOARD_FIELDS = Object.keys(dashboardInterface.shape).filter(
  (key) => !(key in apiCreateDashboardFields.shape),
);

export const apiCreateDashboardBody = z.preprocess(
  (raw) => withoutKeys(raw, READ_ONLY_DASHBOARD_FIELDS),
  apiCreateDashboardFields,
);

const apiUpdateDashboardFields = apiCreateDashboardFields
  .omit({ experimentId: true, blocks: true })
  .extend({
    blocks: z.array(apiUpdateDashboardBlock),
  })
  .partial();

/** `experimentId` too: an update cannot reparent a dashboard, but a GET still returns it. */
export const apiUpdateDashboardBody = z.preprocess(
  (raw) => withoutKeys(raw, [...READ_ONLY_DASHBOARD_FIELDS, "experimentId"]),
  apiUpdateDashboardFields,
);

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
