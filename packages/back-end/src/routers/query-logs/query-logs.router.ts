import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawQueryLogsController from "./query-logs.controller";

const router = express.Router();

const queryLogsController = wrapController(rawQueryLogsController);

router.get(
  "/datasource/:id/usage",
  validateRequestMiddleware({
    params: z.object({ id: z.string() }).strict(),
  }),
  queryLogsController.getDataSourceUsage,
);

export { router as queryLogsRouter };
