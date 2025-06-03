import { z } from "zod";
import { dashboardBlockInterface } from "./dashboard-block";

const dashboardSettings = z
  .object({
    defaultMetricId: z.string(),
    defaultDimensionId: z.string(),
    baselineRow: z.string(),
    defaultDimensionValues: z.array(z.string()),
    defaultVariationIds: z.array(z.string()),
    dateStart: z.date(),
    dateEnd: z.date(),
  })
  .strict();

const dashboardData = z
  .object({
    title: z.string(),
    blocks: z.array(dashboardBlockInterface),
    settings: dashboardSettings,
  })
  .strict();

export const dashboardInstanceInterface = dashboardData
  .extend({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

export type DashboardSettings = z.infer<typeof dashboardSettings>;

export type DashboardData = z.infer<typeof dashboardData>;

export type DashboardInstanceInterface = z.infer<
  typeof dashboardInstanceInterface
>;
