import { z } from "zod";
import { dashboardBlockInterface } from "./dashboard-block";

export const dashboardInstanceInterface = z.object({
  id: z.string(),
  organizationId: z.string(),
  experiment: z.string(),
  dateCreated: z.date(),
  dateUpdated: z.date(),
  title: z.string(),
  blocks: z.array(dashboardBlockInterface),
});

export type DashboardInstanceInterface = z.infer<
  typeof dashboardInstanceInterface
>;
