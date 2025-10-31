import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import {
  createFactFilterPropsValidator,
  createFactTablePropsValidator,
  updateFactFilterPropsValidator,
  updateColumnPropsValidator,
  updateFactTablePropsValidator,
  testFactFilterPropsValidator,
} from "./fact-table.validators";
import * as rawFactTableController from "./fact-table.controller";

const router = express.Router();

const factTableController = wrapController(rawFactTableController);

const factTableParams = z.object({ id: z.string() }).strict();
const columnParams = z.object({ id: z.string(), column: z.string() }).strict();
const filterParams = z
  .object({ id: z.string(), filterId: z.string() })
  .strict();

router.post(
  "/fact-tables",
  validateRequestMiddleware({
    body: createFactTablePropsValidator,
  }),
  factTableController.postFactTable,
);

router.put(
  "/fact-tables/:id",
  validateRequestMiddleware({
    params: factTableParams,
    body: updateFactTablePropsValidator,
  }),
  factTableController.putFactTable,
);

router.post("/fact-tables/:id/archive", factTableController.archiveFactTable);

router.post(
  "/fact-tables/:id/unarchive",
  factTableController.unarchiveFactTable,
);

router.delete(
  "/fact-tables/:id",
  validateRequestMiddleware({
    params: factTableParams,
  }),
  factTableController.deleteFactTable,
);

router.put(
  "/fact-tables/:id/column/:column",
  validateRequestMiddleware({
    params: columnParams,
    body: updateColumnPropsValidator,
  }),
  factTableController.putColumn,
);

router.post(
  "/fact-tables/:id/filter",
  validateRequestMiddleware({
    params: factTableParams,
    body: createFactFilterPropsValidator,
  }),
  factTableController.postFactFilter,
);

router.put(
  "/fact-tables/:id/filter/:filterId",
  validateRequestMiddleware({
    params: filterParams,
    body: updateFactFilterPropsValidator,
  }),
  factTableController.putFactFilter,
);

router.post(
  "/fact-tables/:id/test-filter",
  validateRequestMiddleware({
    params: factTableParams,
    body: testFactFilterPropsValidator,
  }),
  factTableController.postFactFilterTest,
);

router.delete(
  "/fact-tables/:id/filter/:filterId",
  validateRequestMiddleware({
    params: filterParams,
  }),
  factTableController.deleteFactFilter,
);

router.post("/fact-metrics", factTableController.postFactMetric);

router.put("/fact-metrics/:id", factTableController.putFactMetric);

router.delete("/fact-metrics/:id", factTableController.deleteFactMetric);

export { router as factTableRouter };
