import { z } from "zod";
import { dashboardBlockInterface } from "./dashboard-block";

export const dashboardEditLevel = z.enum(["organization", "private"]);

export const dashboardInterface = z
  .object({
    id: z.string(),
    uid: z.string(), // Enables sharing/linking to dashboards in future
    organization: z.string(),
    experimentId: z.string(),
    isDefault: z.boolean(), // Deprecated
    isDeleted: z.boolean(), // For soft-deletes (currently unused)
    userId: z.string(),
    editLevel: dashboardEditLevel,
    enableAutoUpdates: z.boolean(),
    title: z.string(),
    blocks: z.array(dashboardBlockInterface),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

export type DashboardInterface = z.infer<typeof dashboardInterface>;
