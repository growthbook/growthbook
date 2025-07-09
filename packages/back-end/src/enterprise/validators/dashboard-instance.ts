import { z } from "zod";
import { dashboardBlockInterface } from "./dashboard-block";

export const dashboardEditLevel = z.enum(["organization", "private"]);

export const dashboardInstanceInterface = z
  .object({
    id: z.string(),
    organization: z.string(),
    experimentId: z.string(),
    userId: z.string(),
    editLevel: dashboardEditLevel,
    enableAutoUpdates: z.boolean(),
    title: z.string(),
    blocks: z.array(dashboardBlockInterface),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

export type DashboardInstanceInterface = z.infer<
  typeof dashboardInstanceInterface
>;
