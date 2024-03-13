import express from "express";
import z from "zod";
import { validateRequestMiddleware } from "@/src/routers/utils/validateRequestMiddleware";
import { wrapController } from "@/src/routers//wrapController";
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
  dataExportController.getDataExportForEvents
);

export { router as dataExportRouter };
