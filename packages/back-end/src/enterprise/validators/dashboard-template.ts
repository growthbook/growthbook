import { z } from "zod";
import { dashboardBlockInterface } from "./dashboard-block";

export const DashboardTemplateInterface = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    title: z.string(),
    blocks: z.array(dashboardBlockInterface),
  })
  .strict();

export type DashboardTemplateInterface = z.infer<
  typeof DashboardTemplateInterface
>;
