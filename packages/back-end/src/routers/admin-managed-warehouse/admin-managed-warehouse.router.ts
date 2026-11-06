import express from "express";
import { z } from "zod";
import { MANAGED_WAREHOUSE_RECREATABLE_TABLES } from "shared/util";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawController from "./admin-managed-warehouse.controller";

// Super-admin recreates of Managed Warehouse tables across orgs
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
router.get(
  "/admin/organization/:orgId/managed-warehouse/recreate",
  validateRequestMiddleware({ params: z.object({ orgId: z.string() }) }),
  controller.getOrganizationRecreate,
);

export { router as adminManagedWarehouseRouter };
