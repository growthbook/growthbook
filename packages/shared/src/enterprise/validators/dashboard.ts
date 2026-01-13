import { z } from "zod";
import { dashboardBlockInterface } from "./dashboard-block";

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

export const displaySettings = z.object({
  color: z.string(),
  displayName: z.string().optional(),
  hidden: z.boolean().optional(),
});

export type DisplaySettings = z.infer<typeof displaySettings>;

export const seriesDisplaySettings = z.record(
  z.string(),
  z.record(z.string(), displaySettings),
);

export type SeriesDisplaySettings = z.infer<typeof seriesDisplaySettings>;

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
    seriesDisplaySettings: seriesDisplaySettings.optional(),
    projects: z.array(z.string()).optional(), // General dashboards only, experiment dashboards use the experiment's projects
    nextUpdate: z.date().optional(),
    lastUpdated: z.date().optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

export type DashboardInterface = z.infer<typeof dashboardInterface>;

export type DashboardEditLevel = z.infer<typeof dashboardEditLevel>;
export type DashboardShareLevel = z.infer<typeof dashboardShareLevel>;
export type DashboardUpdateSchedule = z.infer<typeof dashboardUpdateSchedule>;
