import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawDataExportController from "./data-export.controller";

const router = express.Router();

const dataExportController = wrapController(rawDataExportController);

router.get(
  "/events",
  validateRequestMiddleware({
    query: z
      .object({
        type: z.enum(["json"]),
      })
      .strict(),
  }),
  dataExportController.getDataExportForEvents,
);

export { router as dataExportRouter };
