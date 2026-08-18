import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawEventLogsController from "./event-logs.controller";

const router = express.Router();

const eventLogsController = wrapController(rawEventLogsController);
const MAX_FILTER_LENGTH = 255;
const filterString = z.string().max(MAX_FILTER_LENGTH);

router.get(
  "/summary",
  validateRequestMiddleware({
    query: z
      .object({
        dateFrom: z.string().datetime(),
        dateTo: z.string().datetime(),
        search: filterString.optional(),
        project: filterString.optional(),
        page: z.string().regex(/^\d+$/).optional(),
      })
      .strict(),
  }),
  eventLogsController.listSummary,
);

router.get(
  "/records",
  validateRequestMiddleware({
    query: z
      .object({
        dateFrom: z.string().datetime(),
        dateTo: z.string().datetime(),
        eventName: filterString.optional(),
        userId: filterString.optional(),
        environment: filterString.optional(),
        browser: filterString.optional(),
        os: filterString.optional(),
        country: filterString.optional(),
        sdk: filterString.optional(),
        project: filterString.optional(),
        page: z.string().regex(/^\d+$/).optional(),
      })
      .strict(),
  }),
  eventLogsController.listRecords,
);

export { router as eventLogsRouter };
