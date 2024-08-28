import express from "express";
import z from "zod";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
import * as rawAskAnythingController from "./ask-anything.controller";

const router = express.Router();

const AskAnythingController = wrapController(rawAskAnythingController);

router.post(
  "/",
  validateRequestMiddleware({
    body: z.object({
      query: z.string(),
      queryContext: z.object({}).passthrough().optional(),
      path: z.string(),
    }),
  }),
  AskAnythingController.postQuery
);

export { router as AskAnythingRouter };
