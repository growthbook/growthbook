import { z } from "zod";
import { dashboardBlockInterface } from "./dashboard-block";

export const DashboardTemplateInterface = z.object({
  id: z.string(),
  organizationId: z.string(),
  dateCreated: z.date(),
  dateUpdated: z.date(),
  title: z.string(),
  blocks: z.array(dashboardBlockInterface),
});

export type DashboardTemplateInterface = z.infer<
  typeof DashboardTemplateInterface
>;
