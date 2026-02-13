import { z } from "zod";
import { dashboardBlockPartial } from "./dashboard-block.js";
import { dashboardEditLevel } from "./dashboard.js";

export const dashboardTemplateInterface = z
  .object({
    id: z.string(),
    organization: z.string(),
    userId: z.string(),
    editLevel: dashboardEditLevel,
    instanceEditLevel: dashboardEditLevel,
    enableAutoUpdates: z.boolean(),
    title: z.string(),
    blockInitialValues: z.array(dashboardBlockPartial),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

export type DashboardTemplateInterface = z.infer<
  typeof dashboardTemplateInterface
>;
