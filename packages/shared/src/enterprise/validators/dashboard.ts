import { z } from "zod";
import {
  apiCreateDashboardBlockInterface,
  apiDashboardBlockInterface,
  dashboardBlockInterface,
} from "./dashboard-block.js";

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
    projects: z.array(z.string()).optional(), // General dashboards only, experiment dashboards use the experiment's projects
    nextUpdate: z.date().optional(),
    lastUpdated: z.date().optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

export const apiDashboardInterface = dashboardInterface
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
  });

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
