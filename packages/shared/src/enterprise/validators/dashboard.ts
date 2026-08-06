import { z } from "zod";
import type {
  ExperimentMetricInterface,
  SliceLevelsData,
} from "shared/experiments";
import type { CommercialFeature } from "shared/enterprise";
import type { MetricGroupInterface } from "shared/types/metric-groups";
import type { FactTableInterface } from "shared/types/fact-table";
import type { DimensionInterface } from "shared/types/dimension";
import type { ProjectInterface } from "shared/types/project";
import type { OrganizationSettings } from "shared/types/organization";
import type { ExperimentInterfaceStringDates } from "shared/types/experiment";
import type { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import type { MetricAnalysisInterface } from "shared/types/metric-analysis";
import type { SavedQuery } from "../../validators/saved-queries";
import {
  dateGranularity,
  baseExplorationConfigValidator,
  type ProductAnalyticsExploration,
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
// "public" is unauthenticated; "published" is organization-visible.
export const dashboardShareLevel = z.enum(["published", "private", "public"]);
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
    // Dashboard-wide period comparison. Currently set only per exploration
    // block; this is the seam for a future dashboard-level compare toggle
    // (see resolveBlockComparison) and is honored on refresh/render already.
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
    shareLevel: dashboardShareLevel.describe(
      'General Dashboards only. "published" dashboards are viewable by organization members with appropriate permissions; "public" dashboards are viewable by anyone with the share URL (no authentication); "private" dashboards are viewable only by the owner.',
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

export type DashboardSSRData = {
  metrics: Record<string, ExperimentMetricInterface>;
  metricGroups: MetricGroupInterface[];
  factTables: Record<string, FactTableInterface>;
  factMetricSlices: Record<
    string,
    Array<{
      id: string;
      name: string;
      description: string;
      baseMetricId: string;
      sliceLevels: SliceLevelsData[];
      allSliceLevels: string[];
    }>
  >;
  dimensions: DimensionInterface[];
  projects: Record<string, ProjectInterface>;
  settings: OrganizationSettings;
  experiments: Record<string, Partial<ExperimentInterfaceStringDates>>;
  commercialFeatures?: CommercialFeature[];
};

export type DashboardPublicBlockData = {
  snapshots: ExperimentSnapshotInterface[];
  savedQueries: SavedQuery[];
  metricAnalyses: MetricAnalysisInterface[];
  explorations: ProductAnalyticsExploration[];
};
