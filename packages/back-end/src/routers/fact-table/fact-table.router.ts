import express from "express";
import z from "zod";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
import {
  createFactFilterPropsValidator,
  createFactMetricPropsValidator,
  createFactPropsValidator,
  createFactTablePropsValidator,
  updateFactFilterPropsValidator,
  updateFactMetricPropsValidator,
  updateFactPropsValidator,
  updateFactTablePropsValidator,
} from "./fact-table.validators";
import * as rawFactTableController from "./fact-table.controller";

const router = express.Router();

const factTableController = wrapController(rawFactTableController);

const factTableParams = z.object({ id: z.string() }).strict();
const factMetricParams = z.object({ id: z.string() }).strict();
const factParams = z.object({ id: z.string(), factId: z.string() }).strict();
const filterParams = z
  .object({ id: z.string(), filterId: z.string() })
  .strict();

router.post(
  "/fact-tables",
  validateRequestMiddleware({
    body: createFactTablePropsValidator,
  }),
  factTableController.postFactTable
);

router.put(
  "/fact-tables/:id",
  validateRequestMiddleware({
    params: factTableParams,
    body: updateFactTablePropsValidator,
  }),
  factTableController.putFactTable
);

router.delete(
  "/fact-tables/:id",
  validateRequestMiddleware({
    params: factTableParams,
  }),
  factTableController.deleteFactTable
);

router.post(
  "/fact-tables/:id/fact",
  validateRequestMiddleware({
    params: factTableParams,
    body: createFactPropsValidator,
  }),
  factTableController.postFact
);

router.put(
  "/fact-tables/:id/fact/:factId",
  validateRequestMiddleware({
    params: factParams,
    body: updateFactPropsValidator,
  }),
  factTableController.putFact
);

router.delete(
  "/fact-tables/:id/fact/:factId",
  validateRequestMiddleware({
    params: factParams,
  }),
  factTableController.deleteFact
);

router.post(
  "/fact-tables/:id/filter",
  validateRequestMiddleware({
    params: factTableParams,
    body: createFactFilterPropsValidator,
  }),
  factTableController.postFactFilter
);

router.put(
  "/fact-tables/:id/filter/:filterId",
  validateRequestMiddleware({
    params: filterParams,
    body: updateFactFilterPropsValidator,
  }),
  factTableController.putFactFilter
);

router.delete(
  "/fact-tables/:id/filter/:filterId",
  validateRequestMiddleware({
    params: filterParams,
  }),
  factTableController.deleteFactFilter
);

router.post(
  "/fact-metrics",
  validateRequestMiddleware({
    body: createFactMetricPropsValidator,
  }),
  factTableController.postFactMetric
);

router.put(
  "/fact-metrics/:id",
  validateRequestMiddleware({
    params: factMetricParams,
    body: updateFactMetricPropsValidator,
  }),
  factTableController.putFactMetric
);

router.delete(
  "/fact-metrics/:id",
  validateRequestMiddleware({
    params: factMetricParams,
  }),
  factTableController.deleteFactMetric
);

export { router as factTableRouter };
