import express from "express";
import { z } from "zod";
import { MANAGED_WAREHOUSE_RECREATABLE_TABLES } from "shared/util";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import { MANAGED_WAREHOUSE_MIGRATION_VERSION } from "back-end/src/jobs/migrateManagedWarehouse";
import * as rawController from "./admin-managed-warehouse.controller";

// Super-admin recreates and migrations of Managed Warehouses across orgs
const router = express.Router();
const controller = wrapController(rawController);

router.get("/admin/managed-warehouse/recreates", controller.getRecreates);
router.post(
  "/admin/managed-warehouse/recreates",
  validateRequestMiddleware({
    body: z
      .object({
        tables: z.array(z.enum(MANAGED_WAREHOUSE_RECREATABLE_TABLES)).min(1),
        organizations: z.union([
          z.literal("all"),
          z.array(z.string().min(1)).min(1),
        ]),
      })
      .strict(),
  }),
  controller.postRecreates,
);
router.post(
  "/admin/managed-warehouse/recreates/retry-failed",
  controller.postRetryFailedRecreates,
);
router.post(
  "/admin/managed-warehouse/recreates/cancel-pending",
  controller.postCancelPendingRecreates,
);
router.delete(
  "/admin/managed-warehouse/recreates/:orgId",
  validateRequestMiddleware({ params: z.object({ orgId: z.string() }) }),
  controller.deleteRecreate,
);

router.get("/admin/managed-warehouse/migrations", controller.getMigrations);
router.post(
  "/admin/managed-warehouse/migrations",
  validateRequestMiddleware({
    body: z
      .object({
        version: z
          .number()
          .int()
          .min(0)
          .max(MANAGED_WAREHOUSE_MIGRATION_VERSION),
        organizations: z.union([
          z.literal("all"),
          z.array(z.string().min(1)).min(1),
        ]),
      })
      .strict(),
  }),
  controller.postMigrations,
);

export { router as adminManagedWarehouseRouter };
