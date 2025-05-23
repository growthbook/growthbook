import express from "express";
import z from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawQueryController from "./query.controller";

const router = express.Router();

const QueryController = wrapController(rawQueryController);

router.get(
  "/queries/:id",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
  }),
  QueryController.getQuery
);

export { router as QueryRouter };
