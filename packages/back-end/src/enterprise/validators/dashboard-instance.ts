import { z } from "zod";
import { dashboardBlockInterface } from "./dashboard-block";

export const dashboardSettingsInterface = z
  .object({
    defaultSnapshotSettings: z
      .object({
        dimensionId: z.string(),
      })
      .strict(),
    defaultAnalysisSettings: z
      .object({
        baselineVariationIndex: z.number(),
        differenceType: z.enum(["relative", "absolute", "scaled"]),
      })
      .strict(),
    dateStart: z.date(),
    dateEnd: z.date(),
    defaultMetricId: z.string(),
    defaultVariationIds: z.array(z.string()),
    defaultDimensionValues: z.array(z.string()),
  })
  .strict();

export const dashboardSettingsStringDates = dashboardSettingsInterface
  .omit({ dateStart: true, dateEnd: true })
  .extend({ dateStart: z.string(), dateEnd: z.string() })
  .strict();

export const dashboardInstanceInterface = z
  .object({
    id: z.string(),
    organization: z.string(),
    experimentId: z.string(),
    owner: z.string(),
    title: z.string(),
    description: z.string(),
    blocks: z.array(dashboardBlockInterface),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    settings: dashboardSettingsInterface,
  })
  .strict();

export type DashboardSettingsInterface = z.infer<
  typeof dashboardSettingsInterface
>;

export type DashboardSettingsStringDates = z.infer<
  typeof dashboardSettingsStringDates
>;

export type DashboardInstanceInterface = z.infer<
  typeof dashboardInstanceInterface
>;
