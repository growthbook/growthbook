import express from "express";
import z from "zod";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
import {
  createFactPropsValidator,
  createFactTablePropsValidator,
  updateFactPropsValidator,
  updateFactTablePropsValidator,
} from "./fact-table.validators";
import * as rawFactTableController from "./fact-table.controller";

const router = express.Router();

const factTableController = wrapController(rawFactTableController);

const factTableParams = z.object({ id: z.string() }).strict();
const factParams = z.object({ id: z.string(), factId: z.string() }).strict();

router.post(
  "/",
  validateRequestMiddleware({
    body: createFactTablePropsValidator,
  }),
  factTableController.postFactTable
);

router.put(
  "/:id",
  validateRequestMiddleware({
    params: factTableParams,
    body: updateFactTablePropsValidator,
  }),
  factTableController.putFactTable
);

router.delete(
  "/:id",
  validateRequestMiddleware({
    params: factTableParams,
  }),
  factTableController.deleteFactTable
);

router.post(
  "/:id/fact",
  validateRequestMiddleware({
    params: factTableParams,
    body: createFactPropsValidator,
  }),
  factTableController.postFact
);

router.put(
  "/:id/fact/:factId",
  validateRequestMiddleware({
    params: factParams,
    body: updateFactPropsValidator,
  }),
  factTableController.putFact
);

router.delete(
  "/:id/fact/:factId",
  validateRequestMiddleware({
    params: factParams,
  }),
  factTableController.deleteFact
);

export { router as factTableRouter };
