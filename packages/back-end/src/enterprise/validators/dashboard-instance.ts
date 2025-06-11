import { z } from "zod";
import { dashboardBlockInterface } from "./dashboard-block";

const dashboardSettingsInterface = z
  .object({
    baselineRow: z.number(),
    dateStart: z.date(),
    dateEnd: z.date(),
    defaultMetricId: z.string(),
    defaultVariationIds: z.array(z.string()),
    defaultDimensionId: z.string(),
    defaultDimensionValues: z.array(z.string()),
  })
  .strict();

export const dashboardInstanceInterface = z
  .object({
    id: z.string(),
    organization: z.string(),
    title: z.string(),
    blocks: z.array(dashboardBlockInterface),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    settings: dashboardSettingsInterface,
  })
  .strict();

export type DashboardSettingsInterface = z.infer<
  typeof dashboardSettingsInterface
>;

export type DashboardInstanceInterface = z.infer<
  typeof dashboardInstanceInterface
>;
