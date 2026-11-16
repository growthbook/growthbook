import { z } from "zod";
import { MANAGED_WAREHOUSE_RECREATABLE_TABLES } from "../util/managedWarehouse";

export const managedWarehouseRecreateStatusValidator = z.enum([
  "pending",
  "running",
  "done",
  "failed",
]);

/**
 * A super admin's request to recreate an org's Managed Warehouse tables. Stored
 * top-level on the org's datasource document (outside `settings`, so datasource
 * saves can't overwrite it) and worked through by the recreate sweep job.
 */
export const managedWarehouseRecreateRequestValidator = z.object({
  tables: z.array(z.enum(MANAGED_WAREHOUSE_RECREATABLE_TABLES)).min(1),
  requestedBy: z.string(),
  requestedAt: z.date(),
  status: managedWarehouseRecreateStatusValidator,
  startedAt: z.date().optional(),
  finishedAt: z.date().optional(),
  error: z.string().optional(),
});

export type ManagedWarehouseRecreateStatus = z.infer<
  typeof managedWarehouseRecreateStatusValidator
>;
export type ManagedWarehouseRecreateRequest = z.infer<
  typeof managedWarehouseRecreateRequestValidator
>;
